import { Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Model, Types } from 'mongoose';
import { z } from 'zod';
import { Errors } from '../common/app-exception';
import { type AuthUser, CurrentUser, Public } from '../common/decorators';
import { objectId, ObjectIdPipe } from '../common/util';
import { ZodPipe } from '../common/zod.pipe';
import { LOCAL_EVENT_MODEL, LocalEvent } from '../local-events/local-event.schema';
import { RbacService } from '../rbac/rbac.service';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { StatsService, type StatTick } from '../stats/stats.service';
import { USER_MODEL, User } from '../users/user.schema';
import { ExportsService } from './exports.service';
import { issueLivePass, readLivePass } from './live';
import { ReportsService } from './reports.service';

type Id = Types.ObjectId;
const FestQuery = z.object({ festId: objectId });
const ExportQuery = z.object({ festId: objectId, eventId: objectId.optional() });
const HEARTBEAT_MS = 20_000;
const FLUSH_MS = 500; // ≤ 2 messages per second per connection

@Controller()
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exports: ExportsService,
    private readonly stats: StatsService,
    private readonly rbac: RbacService,
    @InjectModel(USER_MODEL) private readonly users: Model<User>,
    @InjectModel(LOCAL_EVENT_MODEL) private readonly events: Model<LocalEvent>,
  ) {}

  @RequirePermission('report.read')
  @Get('reports/overview')
  overview(@Query(new ZodPipe(FestQuery)) q: { festId: Id }, @CurrentUser() u: AuthUser) {
    return this.reports.overview(u, q.festId);
  }

  @RequirePermission('report.read')
  @Get('reports/colleges')
  colleges(@Query(new ZodPipe(FestQuery)) q: { festId: Id }, @CurrentUser() u: AuthUser) {
    return this.reports.colleges(u, q.festId);
  }

  /** Recompute a fest's counters from the source data (backfill / repair). Super Admin. */
  @RequirePermission('settings.manage')
  @Post('reports/rebuild')
  @HttpCode(200)
  rebuild(@Query(new ZodPipe(FestQuery)) q: { festId: Id }) {
    return this.reports.rebuild(q.festId);
  }

  /** CSV download, streamed (the client fetches it with its Authorization header, then saves the blob). */
  @RequirePermission('report.read')
  @Get('exports/registrations.csv')
  async exportRegistrations(@Query(new ZodPipe(ExportQuery)) q: { festId: Id; eventId?: Id }, @CurrentUser() u: AuthUser, @Res() reply: FastifyReply) {
    const { filename, stream } = await this.exports.registrations(u, q.festId, q.eventId);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .header('cache-control', 'private, no-store')
      .send(stream);
  }

  // ── live updates (server-sent events) ──

  /** A short-lived pass for EventSource (which can't send an Authorization header). */
  @RequirePermission('report.read')
  @Post('live/pass')
  @HttpCode(200)
  pass(@Query(new ZodPipe(FestQuery)) q: { festId: Id }, @CurrentUser() u: AuthUser) {
    return issueLivePass(u.id, String(q.festId));
  }

  /**
   * A fest's live counters. One listener per connection on the in-process stats bus (no DB polling);
   * ticks are merged and flushed at most twice a second; a comment line every 20 s keeps proxies
   * from closing the stream. Department-scoped viewers only get their own events' ticks.
   */
  @Public()
  @SkipThrottle()
  @Get('live/fests/:festId')
  async live(@Param('festId', ObjectIdPipe) festId: Id, @Query('pass') pass: string | undefined, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const userId = pass ? readLivePass(pass, String(festId)) : null;
    const u = userId ? await this.users.findById(userId).select('roles status session_version').lean() : null;
    if (!u || u.status !== 'ACTIVE') throw Errors.unauthorized('LIVE_PASS_INVALID', 'Live updates need a fresh pass');
    const viewer: AuthUser = { id: userId!, sv: u.session_version, roles: u.roles.map((r) => ({ r: r.role, st: r.scope_type, sid: r.scope_id ? String(r.scope_id) : null })) };
    if (!this.rbac.hasAny(viewer, 'report.read')) throw Errors.forbidden('FORBIDDEN', "You don't have access to these reports");

    const festWide = this.rbac.can(viewer, 'report.read', { globalEventId: festId });
    const seen = new Map<string, boolean>();
    const maySee = async (eventId: string) => {
      if (festWide) return true;
      if (!seen.has(eventId)) {
        const e = await this.events.findById(eventId).select('department_id').lean();
        seen.set(eventId, !!e && this.rbac.can(viewer, 'report.read', { globalEventId: festId, departmentId: e.department_id, localEventId: eventId }));
      }
      return seen.get(eventId)!;
    };

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 5000\nevent: hello\ndata: {}\n\n');

    let pending: Record<string, number> = {};
    let flushTimer: NodeJS.Timeout | null = null;
    const flush = () => {
      flushTimer = null;
      if (!Object.keys(pending).length) return;
      res.write(`event: tick\ndata: ${JSON.stringify(pending)}\n\n`);
      pending = {};
    };
    const onTick = (t: StatTick) => {
      void maySee(t.eventId).then((ok) => {
        if (!ok) return;
        for (const [k, v] of Object.entries(t.inc)) pending[k] = (pending[k] ?? 0) + (v ?? 0);
        flushTimer ??= setTimeout(flush, FLUSH_MS);
      });
    };
    const channel = `fest:${festId}`;
    this.stats.bus.on(channel, onTick);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    // Disconnect → no listener, no timers left behind.
    req.raw.on('close', () => {
      this.stats.bus.off(channel, onTick);
      clearInterval(heartbeat);
      if (flushTimer) clearTimeout(flushTimer);
    });
  }
}

import { existsSync, readdirSync } from 'node:fs';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

/** Prefer an installed mongod (no ~300 MB download). CI/Linux falls back to an auto-downloaded binary. */
function findLocalMongod(): string | undefined {
  if (process.env.MONGOMS_SYSTEM_BINARY) return process.env.MONGOMS_SYSTEM_BINARY;
  const root = 'C:/Program Files/MongoDB/Server';
  if (!existsSync(root)) return undefined;
  const versions = readdirSync(root).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    const bin = `${root}/${v}/bin/mongod.exe`;
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

let rs: MongoMemoryReplSet | undefined;

export async function setup(project: TestProject) {
  const systemBinary = findLocalMongod();
  // Replica set (not standalone) because the app uses transactions.
  rs = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    binary: systemBinary ? { systemBinary } : { version: '8.0.4' },
  });
  project.provide('mongoUri', rs.getUri());
}

export async function teardown() {
  await rs?.stop();
}

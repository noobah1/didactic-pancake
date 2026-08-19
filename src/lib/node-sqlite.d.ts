// @types/node (pinned to ^20 in package.json) predates node:sqlite, which
// landed experimentally in Node 22.5 and is what the node:lts-alpine image
// actually ships (confirmed live: node:lts-alpine resolves to Node 24, where
// `require('node:sqlite').DatabaseSync` exists and works). Minimal ambient
// types for exactly the surface src/lib/db.ts uses, rather than bumping
// @types/node across the whole project for one module.
declare module 'node:sqlite' {
  export type SqliteValue = string | number | bigint | null | Uint8Array

  export interface StatementResultingChanges {
    changes: number | bigint
    lastInsertRowid: number | bigint
  }

  export class StatementSync {
    run(...params: SqliteValue[]): StatementResultingChanges
    all(...params: SqliteValue[]): Record<string, SqliteValue>[]
    get(...params: SqliteValue[]): Record<string, SqliteValue> | undefined
  }

  export interface DatabaseSyncOptions {
    open?: boolean
  }

  export class DatabaseSync {
    constructor(location: string, options?: DatabaseSyncOptions)
    exec(sql: string): void
    prepare(sql: string): StatementSync
    close(): void
  }
}

"use strict";

import BetterSQLite3 from "better-sqlite3";

const VALUE_STORAGE_TABLE = "__STORAGE";
const META_STORAGE_TABLE = "__META";

type JsonSerializable = string | number | {
    [key: string]: JsonSerializable
} | JsonSerializable[] | boolean | null;
type StorageOptions = {
    path: string,
    databaseLog?: (message: any, ...additionalArgs: any[]) => void,
    destructorPassword?: string,
    metaTable?: {
        [key: string]: JsonSerializable
    }
};

export default class Storage {
    static get VALUE_STORAGE_TABLE(): string {
        return VALUE_STORAGE_TABLE;
    }
    static get META_STORAGE_TABLE(): string {
        return META_STORAGE_TABLE;
    }

    #dbFilePath: string;
    #db: BetterSQLite3.Database;
    #destructorPassword: string | undefined;

    #keyFn: (index: number) => string | null;
    #entriesFn: () => [string, JsonSerializable | undefined][];
    #keysFn: () => string[];
    #valuesFn: () => (JsonSerializable | undefined)[];
    #getFn: (key: string) => JsonSerializable | undefined;
    #setFn: (key: string, value: JsonSerializable) => void;
    #removeFn: (key: string) => void;
    #clearFn: () => void;

    constructor(pathOrOptions: StorageOptions | string) {
        this.#dbFilePath = typeof pathOrOptions === "string" ? pathOrOptions : pathOrOptions.path;
        const verbose = typeof pathOrOptions !== "string" && pathOrOptions.databaseLog ? pathOrOptions.databaseLog : undefined;
        const db = this.#db = new BetterSQLite3(this.#dbFilePath, {
            verbose
        });

        this.#destructorPassword = typeof pathOrOptions !== "string" ? pathOrOptions.destructorPassword : undefined;

        db.pragma("journal_mode = WAL");

        db.exec(`
            CREATE TABLE IF NOT EXISTS
                ${VALUE_STORAGE_TABLE} (key TEXT PRIMARY KEY, value TEXT, createdAt TEXT not null default (DATETIME('now') || substr(strftime('.%f','now'),4)));
        `);

        const setValueStmt = db.prepare(`
            INSERT INTO ${VALUE_STORAGE_TABLE}(key, value)
                VALUES(:key, :value)
                ON CONFLICT(key) DO UPDATE SET
                    value=:value
                WHERE key=:key;
        `);
        const getStmt = db.prepare(`
            SELECT value FROM ${VALUE_STORAGE_TABLE} WHERE key=:key;
        `);
        const keysStmt = db.prepare(`
            SELECT key, value FROM ${VALUE_STORAGE_TABLE} ORDER BY createdAt ASC;
        `);
        const removeStmt = db.prepare(`
            DELETE FROM ${VALUE_STORAGE_TABLE} WHERE key=:key;
        `);
        const clearStmt = db.prepare(`
            DELETE FROM ${VALUE_STORAGE_TABLE};
        `);

        if (typeof pathOrOptions !== "string" && pathOrOptions.metaTable)
            db.transaction((): void => {
                db.exec(`
                    CREATE TABLE IF NOT EXISTS
                        ${META_STORAGE_TABLE} (key TEXT PRIMARY KEY, value TEXT, createdAt TEXT not null default (DATETIME('now') || substr(strftime('.%f','now'),4)));
                `);

                const setMetaStmt = db.prepare(`
                    INSERT INTO ${META_STORAGE_TABLE}(key, value)
                        VALUES(:key, :value)
                        ON CONFLICT(key) DO UPDATE SET
                            value=:value
                        WHERE key=:key;
                `);
                for (const [key, value] of Object.entries(pathOrOptions.metaTable || {})) {
                    try {
                        setMetaStmt.run({
                            key,
                            value: JSON.stringify(value)
                        });
                    } catch (error) {
                        console.warn(`Error while setting META Table key: ${key}`, error);
                    }
                }
            })();

        this.#keyFn = (index) => {
            const rows = this.#keysFn();
            return rows[index] || null;
        };
        this.#entriesFn = () => {
            const rows: {
                key: string,
                value: string
            }[] = keysStmt.all();
            return rows.map(row => {
                try {
                    return [row.key, JSON.parse(row.value)];
                } catch (error) {
                    return [row.key, undefined];
                }
            });
        };
        this.#keysFn = () => {
            const rows = this.#entriesFn();
            return rows.map(row => row[0]);
        };
        this.#valuesFn = () => {
            const rows = this.#entriesFn();
            return rows.map(row => row[1]);
        };
        this.#getFn = (key) => {
            const row = getStmt.get({
                table: VALUE_STORAGE_TABLE,
                key
            });

            try {
                return JSON.parse(row.value);
            } catch (error) {
                return undefined;
            }
        };
        this.#setFn = (key, value) => {
            setValueStmt.run({
                key,
                value: JSON.stringify(value)
            });
        };
        this.#removeFn = (key) => {
            removeStmt.run({
                table: VALUE_STORAGE_TABLE,
                key
            });
        };
        this.#clearFn = () => {
            clearStmt.run({
                table: VALUE_STORAGE_TABLE
            });
        };
    }
    __destroy(password?: string): void {
        if (this.#destructorPassword && password !== this.#destructorPassword) return;
        this.#db.close();
    }

    /* localStorage Interface */
    get length(): number {
        return this.#keysFn().length;
    }
    get entries(): [string, JsonSerializable | undefined][] {
        return this.#entriesFn();
    }
    get keys(): string[] {
        return this.#keysFn();
    }
    get values(): (JsonSerializable | undefined)[] {
        return this.#valuesFn();
    }
    key(index: number): string | null {
        return this.#keyFn(index);
    }
    getItem(keyName: string, defaultValue?: JsonSerializable): JsonSerializable | undefined {
        const item = this.#getFn(keyName);
        if (typeof item !== "undefined") return item;
        return defaultValue;
    }
    setItem(keyName: string, keyValue: JsonSerializable): void {
        this.#setFn(keyName, keyValue);
    }
    removeItem(keyName: string): void {
        this.#removeFn(keyName);
    }
    clear(): void {
        this.#clearFn();
    }

    /* SQLite Interface */
    prepare(source: string): BetterSQLite3.Statement {
        return this.#db.prepare(source);
    }
    transaction(fn: (...args: any[]) => void): BetterSQLite3.Transaction {
        return this.#db.transaction(fn);
    }
    exec(query: string): BetterSQLite3.Database {
        return this.#db.exec(query);
    }
}

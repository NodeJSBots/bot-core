"use strict";

import Storage from "./Storage";
import Plugin from "./Plugin";
import { MetaInformation, PluginDependency } from "./Plugin";
import { resolve, parse } from "path";
import { EventEmitter2 } from "eventemitter2";
import decache from "decache";
import fs from "fs-extra";
import ExtendableError from "./ExtendableError";
import semver from "semver";
import { exec } from "child_process";

export class InvalidPluginError extends ExtendableError { }
export class PluginAlreadyLoadedError extends ExtendableError {
    constructor(filename: string) {
        super(`Plugin ${filename} already loaded!`);
    }
}
export class PluginAlreadyStartedError extends ExtendableError {
    constructor(filename: string) {
        super(`Plugin ${filename} already started!`);
    }
}
export class PluginStillStartedError extends ExtendableError {
    constructor(filename: string) {
        super(`Plugin ${filename} still started!`);
    }
}
export class PluginNotLoadedError extends ExtendableError {
    constructor(filename: string) {
        super(`Plugin ${filename} not loaded!`);
    }
}
export class PluginNotStartedError extends ExtendableError {
    constructor(filename: string) {
        super(`Plugin ${filename} not started!`);
    }
}
export class ApiVersionMismatchError extends ExtendableError {
    constructor(filename: string, api: string, required: string) {
        super(`Plugin "${filename}" requires API "${required}", got v${api}.\nYou may need to update the bot or report this behavior to the plugin author(s).`);
    }
}
export class MissingDependencyError extends ExtendableError {
    constructor(filename: string, dep: { name: string, optional: boolean, version: string, state: string }) {
        super(`${filename} requires Plugin ${dep.name} version "${dep.version}" ${dep.state === "running" ? "started" : "loaded"}. Loading impossible.`);
    }
}
export class FileNotFoundError extends ExtendableError {
    constructor(filename: string) {
        super("File '" + filename + "' not found");
    }
}
export class IllegalMethodAccessError extends ExtendableError {
    constructor(target: string, method: string | symbol) {
        super(`Attempted to access '${method.toString()}' function of plugin '${target}' from another plugin.`);
    }
}

type PluginLoaderConstructorArgs = {
    api: {
        [key: string]: any
    },
    storage?: Storage,
    apiVersion: string,
    baseDir?: string,
    storageDir?: string,
    pluginDir?: string,
    fileExtension?: string,
    definePluginManagerAPI?: boolean | string,
    parentPluginLoader?: PluginLoader3,
    eventEmitterOptions?: {
        wildcard?: boolean,
        delimiter?: string,
        newListener?: boolean,
        removeListener?: boolean,
        maxListeners?: number,
        verboseMemoryLeak?: boolean,
        ignoreErrors?: boolean
    }
};
export type PluginManagerAPI = {
    load: (fileID: string) => Promise<void>,
    unload: (fileID: string) => Promise<void>,
    start: (fileID: string) => Promise<void>,
    stop: (fileID: string) => Promise<void>,
    getInitialPluginState: (fileID: string) => Promise<("started" | "loaded" | "unloaded")>,
    setInititalPluginState: (fileID: string) => Promise<void>,
    listPlugins: (includeParent: boolean) => Promise<string[]>,
    getPlugin: (fileID: string, includeParent: boolean) => Promise<{
        __meta: MetaInformation,
        [key: string]: any
    }>,
    getPluginInfo: (fileID: string, includeParent: boolean) => Promise<MetaInformation>,
    isPluginLoaded: (fileID: string, includeParent: boolean) => boolean,
    getLoadedPlugins: (includeParent: boolean) => string[],
    isPluginStarted: (fileID: string, includeParent: boolean) => boolean,
    getStartedPlugins: (includeParent: boolean) => string[],
    events: EventEmitter2
};
type PluginLoaderEventData = {
    parent: boolean,
    pluginInfo: MetaInformation
};

let injectionPromise: Promise<void> | null = null;
async function injectDependencies(deps: { [key: string]: string } = {}) {
    if (injectionPromise) await injectionPromise;
    let cb = () => {
        return;
    };
    injectionPromise = new Promise(res => cb = () => res());
    try {
        const baseDir = parse(process.argv[1]).dir;
        const packageJSON = await fs.readFile(resolve(baseDir, "./package.json"), "utf-8");
        const pkgJSON = JSON.parse(packageJSON);
        let injectedEntries = 0;
        for (const dep in deps) {
            if (!pkgJSON.dependencies[dep]) {
                pkgJSON.dependencies[dep] = deps[dep];
                console.log(`Injecting ${dep} (${deps[dep]})`);
                injectedEntries++;
            }
        }
        if (injectedEntries) {
            await fs.writeFile(resolve(baseDir, "./package.json"), JSON.stringify(pkgJSON, null, 2));
            try {
                await fs.remove(resolve(baseDir, "./package-lock.json"));
            } catch (error) {
                // eh
            }
            console.log("Injection complete, running `npm install`...");
            await new Promise((res, rej) => {
                exec("npm i", {
                    cwd: baseDir
                })
                    .on("exit", res)
                    .on("error", rej);
            });
            console.log("`npm install` complete");
        }
    } catch (error) {
        console.error(error);
    } finally {
        cb();
    }
}

export default class PluginLoader3 extends EventEmitter2 {
    public static get VERSION(): string {
        return "3.0.0";
    }

    private pluginDir: string;
    private storageDir: string;
    private apiVersion: string;
    private fileExtension: string;
    private parent: PluginLoader3 | null;
    private dependencyTree: {
        [key: string]: {
            [key: string]: string
        }
    } = {};
    private resolverTable: {
        [key: string]: string
    } = {};

    private api: {
        [key: string]: any
    };
    private storage: Storage;

    private loadedPlugins: {
        [key: string]: Plugin
    } = {};
    private startedPlugins: {
        [key: string]: Plugin
    } = {};

    private loadingQueue: {
        plugin: string,
        callback: () => void
    }[] = [];
    private emitter: EventEmitter2;

    private loadedListener: ((resolvedFilename: string, data: PluginLoaderEventData) => void);
    private startedListener: ((resolvedFilename: string, data: PluginLoaderEventData) => void);
    private stoppedListener: ((resolvedFilename: string, data: PluginLoaderEventData) => void);
    private unloadedListener: ((resolvedFilename: string, data: PluginLoaderEventData) => void);
    private parentLoadedListener: ((resolvedFilename: string, data: PluginLoaderEventData) => void) | null | undefined;
    private parentStartedListener: ((resolvedFilename: string, data: PluginLoaderEventData) => void) | null | undefined;
    private parentStoppedListener: ((resolvedFilename: string, data: PluginLoaderEventData) => void) | null | undefined;
    private parentUnloadedListener: ((resolvedFilename: string, data: PluginLoaderEventData) => void) | null | undefined;

    constructor(options: PluginLoaderConstructorArgs) {
        super(options.eventEmitterOptions || {});
        if (!options.baseDir && !(!options.storageDir || !options.pluginDir))
            throw new Error("Directory for plugins/storage missing. Either set a baseDir or storageDir and pluginDir");

        this.storageDir = options.storageDir || resolve(options.baseDir || process.cwd(), "storage");
        this.pluginDir = options.pluginDir || resolve(options.baseDir || process.cwd(), "plugins");

        this.apiVersion = options.apiVersion;
        this.fileExtension = (options.fileExtension || ".plugin").toLowerCase();
        this.parent = options.parentPluginLoader || null;

        this.api = options.api;

        fs.mkdirpSync(resolve(this.storageDir, "plugins"));
        fs.mkdirpSync(this.pluginDir);

        this.storage = options.storage || new Storage({
            path: resolve(this.storageDir, "pluginmanager.sqlite3"),
            metaTable: {
                Module: "PluginLoader",
                Version: PluginLoader3.VERSION
            }
        });

        this.emitter = new EventEmitter2(options.eventEmitterOptions || {});

        const definePMAPI = options.definePluginManagerAPI === undefined ? true : options.definePluginManagerAPI;
        if (definePMAPI) {
            const PM2API: PluginManagerAPI = {
                load: fileID => {
                    console.log(`Plugin requests loading of ${fileID}`);
                    return this.loadPlugin(fileID);
                },
                unload: fileID => {
                    console.log(`Plugin requests unloading of ${fileID}`);
                    return this.unloadPlugin(fileID);
                },
                start: fileID => {
                    console.log(`Plugin requests starting of ${fileID}`);
                    return this.startPlugin(fileID);
                },
                stop: fileID => {
                    console.log(`Plugin requests stopping of ${fileID}`);
                    return this.loadPlugin(fileID);
                },
                getInitialPluginState: fileID => {
                    console.log(`Plugin requests initial loading state of ${fileID}`);
                    return this.getInitialPluginState(fileID);
                },
                setInititalPluginState: (fileID, state: ("started" | "loaded" | "unloaded") = "started") => {
                    console.log(`Plugin changed initial state of ${fileID} to ${state}`);
                    return this.setInitialPluginState(fileID, state);
                },
                listPlugins: includeParent => this.listPlugins(includeParent),
                getPlugin: async (fileID, includeParent = true) => {
                    const resolved = await this.resolvePluginFilename(fileID);
                    const plugin = await this.getPlugin(resolved, includeParent);
                    const metaInfo = plugin.__meta;
                    const newMetaBlock = Object.freeze({
                        name: metaInfo.name,
                        version: metaInfo.version,
                        description: metaInfo.description,
                        author: metaInfo.author,
                        apiVersion: metaInfo.apiVersion,
                    });

                    return Object.freeze(Object.assign({}, plugin.API || {}, {
                        __meta: newMetaBlock
                    }));
                },
                getPluginInfo: async (fileID, includeParent = true) => (await PM2API.getPlugin(fileID, includeParent)).__meta,
                isPluginLoaded: (fileID, includeParent = true) => this.isPluginLoaded(fileID, includeParent),
                getLoadedPlugins: (includeParent = true) => this.getLoadedPlugins(includeParent),
                isPluginStarted: (fileID, includeParent = true) => this.isPluginStarted(fileID, includeParent),
                getStartedPlugins: (includeParent = true) => this.getStartedPlugins(includeParent),
                events: this.emitter
            };

            Object.freeze(PM2API);

            if (typeof definePMAPI === "string") this.api[definePMAPI] = PM2API;
            else this.api.pluginManager = PM2API;
        }

        this.loadedListener = this.startedListener = () => {
            this.loadingQueue.forEach(async queueEntry => {
                try {
                    if (await this.allDependenciesSatisfied(queueEntry.plugin))
                        queueEntry.callback();
                } catch (error) {
                    console.error(error);
                }
            });
        };
        this.unloadedListener = this.stoppedListener = async (filename) => {
            const depTree = this.dependencyTree;
            const isUnloaded = !this.isPluginLoaded(filename);
            await Promise.all(Object.entries(depTree[filename]).map(async ([dependant, state]) => {
                const pInfo = await this.getPluginInfo(dependant, false);
                if (pInfo.stayLoadedOnDependencyLoss) return;
                const isPluginLoaded = this.isPluginLoaded(dependant, false);
                const isPluginStarted = this.isPluginStarted(dependant, false);

                if (state === "started" || (state === "loaded" && isUnloaded)) {
                    if (isPluginStarted) await this.stopPlugin(dependant);
                    if (isPluginLoaded) await this.unloadPlugin(dependant);

                    this.loadPlugin(dependant, isPluginStarted ? "started" : "loaded");
                }
            }));

            if (isUnloaded) delete depTree[filename];
        };

        this.on("pluginLoaded", this.loadedListener);
        this.on("pluginStarted", this.startedListener);
        this.on("pluginStopped", this.stoppedListener);
        this.on("pluginUnloaded", this.unloadedListener);

        if (this.parent) {
            this.parentLoadedListener = (filename, { pluginInfo }) => {
                this.emit("pluginLoaded", filename, {
                    parent: true,
                    pluginInfo
                });
            };
            this.parentStartedListener = (filename, { pluginInfo }) => {
                this.emit("pluginStarted", filename, {
                    parent: true,
                    pluginInfo
                });
            };
            this.parentStoppedListener = (filename, { pluginInfo }) => {
                this.emit("pluginStopped", filename, {
                    parent: true,
                    pluginInfo
                });
            };
            this.parentUnloadedListener = (filename, { pluginInfo }) => {
                this.emit("pluginUnloaded", filename, {
                    parent: true,
                    pluginInfo
                });
            };
            if (this.parentLoadedListener)
                this.parent.on("pluginLoaded", this.parentLoadedListener);
            if (this.parentStartedListener)
                this.parent.on("pluginStarted", this.parentStartedListener);
            if (this.parentStoppedListener)
                this.parent.on("pluginStopped", this.parentStoppedListener);
            if (this.parentUnloadedListener)
                this.parent.on("pluginUnloaded", this.parentUnloadedListener);

            this.parent.on("pluginLoaderDestroy", () => {
                this.parent = null;
                this.parentLoadedListener = null;
                this.parentStartedListener = null;
                this.parentStoppedListener = null;
                this.parentUnloadedListener = null;
            });
        }

    }

    async destroy(): Promise<void> {
        await Promise.all(this.getStartedPlugins(false).map(plugin => this.stopPlugin(plugin)));
        await Promise.all(this.getLoadedPlugins(false).map(plugin => this.unloadPlugin(plugin)));

        if (this.parent) {
            if (this.parentLoadedListener)
                this.parent.removeListener("pluginLoaded", this.parentLoadedListener);
            if (this.parentStartedListener)
                this.parent.removeListener("pluginStarted", this.parentStartedListener);
            if (this.parentStoppedListener)
                this.parent.removeListener("pluginStopped", this.parentStoppedListener);
            if (this.parentUnloadedListener)
                this.parent.removeListener("pluginUnloaded", this.parentUnloadedListener);
        }

        this.emit("pluginLoaderDestroy");

        this.removeAllListeners();
        this.emitter.removeAllListeners();

        this.storage.__destroy();
    }

    async listPlugins(includeParent = true): Promise<string[]> {
        const files = await fs.readdir(this.pluginDir);
        const pluginFiles = files.filter(file => {
            const matched = file.match(/(.*)\.(?:ts|js)$/i);
            if (!matched) return false;
            return matched[1].toLowerCase().endsWith(this.fileExtension.toLowerCase());
        });
        if (this.parent && includeParent) pluginFiles.concat(await this.parent.listPlugins());
        return pluginFiles;
    }

    async resolvePluginFilename(fileID: string): Promise<string> {
        if (this.resolverTable[fileID]) return this.resolverTable[fileID];
        if (!fileID) new InvalidPluginError("No fileID specified");
        const pluginFiles = await this.listPlugins(false);
        const resolvedFilename = pluginFiles.find(filename => filename.toLowerCase().includes(fileID.toLowerCase()));
        if (!resolvedFilename) throw new FileNotFoundError(fileID);
        this.resolverTable[fileID] = resolvedFilename;
        return resolvedFilename;
    }

    async getPlugin(fileID: string, includeParent = true): Promise<Plugin> {
        const resolvedFilename = await this.resolvePluginFilename(fileID);

        if (this.loadedPlugins[resolvedFilename]) {
            return this.loadedPlugins[resolvedFilename];
        } else if (this.parent && includeParent) {
            const plugin = await this.parent.getPlugin(resolvedFilename, includeParent);
            if (plugin) return plugin;
        }

        try {
            decache(resolve(this.pluginDir, resolvedFilename));
            const plugin = (await import(resolve(this.pluginDir, resolvedFilename))).default || null;
            if (plugin && !plugin.__meta)
                throw new InvalidPluginError(`Plugin ${resolvedFilename} missing __meta block`);
            return plugin;
        } catch (error) {
            if (error instanceof SyntaxError)
                throw error;
            else
                throw new InvalidPluginError("Failed to load plugin '" + resolvedFilename + "': " + error + "\n" + error.stack);
        }
    }

    async getPluginInfo(fileID: string, includeParent = true): Promise<MetaInformation> {
        const plugin = await this.getPlugin(fileID, includeParent);
        return plugin.__meta;
    }

    getLoadedPlugins(includeParent = true): string[] {
        const plugins: string[] = [];

        for (const plugin of Object.keys(this.loadedPlugins))
            plugins.push(plugin);

        if (this.parent && includeParent)
            plugins.concat(this.parent.getLoadedPlugins(includeParent));

        return plugins;
    }
    isPluginLoaded(fileID: string, includeParent = true): boolean {
        return !!this.getLoadedPlugins(includeParent).find(pluginName =>
            pluginName.toLowerCase().includes(fileID.toLowerCase())
        );
    }

    getStartedPlugins(includeParent = true): string[] {
        const plugins: string[] = [];

        for (const plugin of Object.keys(this.startedPlugins))
            plugins.push(plugin);

        if (this.parent && includeParent)
            plugins.concat(this.parent.getStartedPlugins(includeParent));

        return plugins;
    }
    isPluginStarted(fileID: string, includeParent = true): boolean {
        return !!this.getStartedPlugins(includeParent).find(pluginName =>
            pluginName.toLowerCase().includes(fileID.toLowerCase())
        );
    }

    async getInitialPluginState(fileID: string): Promise<("started" | "loaded" | "unloaded")> {
        const resolved = await this.resolvePluginFilename(fileID);
        return (this.storage.getItem("pluginstate_" + resolved, "started") as string).toLowerCase() as ("started" | "loaded" | "unloaded");
    }
    async setInitialPluginState(fileID: string, state: ("started" | "loaded" | "unloaded") = "started"): Promise<void> {
        const resolved = await this.resolvePluginFilename(fileID);
        this.storage.setItem("pluginstate_" + resolved, state);
    }

    private async allDependenciesSatisfied(fileID: string, pluginInfo: (MetaInformation | null) = null): Promise<boolean> {
        pluginInfo = pluginInfo || await this.getPluginInfo(fileID);
        if (!pluginInfo) return false;

        if (!semver.satisfies(this.apiVersion, pluginInfo.apiVersion))
            throw new ApiVersionMismatchError(fileID, this.apiVersion, pluginInfo.apiVersion);

        const pluginDependencies = pluginInfo.pluginDependencies || {};
        for (const dependencyName in pluginDependencies) {
            const dep = pluginDependencies[dependencyName];
            const dependency: {
                name: string,
                state: "started" | "loaded",
                optional: boolean,
                version: string
            } = {
                name: dependencyName,
                state: (dep as PluginDependency).state || dep as ("started" | "loaded"),
                optional: (dep as PluginDependency).optional || false,
                version: (dep as PluginDependency).version || "*"
            };

            try {
                const depInfo = await this.getPluginInfo(dependency.name, true);
                if (!semver.satisfies(depInfo.version, dependency.version))
                    throw new MissingDependencyError(fileID, dependency);

                if (dependency.state === "started") {
                    if (!this.isPluginStarted(dependency.name, true)) return false;
                } else {
                    if (!this.isPluginLoaded(dependency.name, true)) return false;
                }
            } catch (error) {
                if (dependency.optional) continue;
                throw error;
            }
        }
        return true;
    }

    async loadPlugin(fileID: string, targetState?: ("started" | "loaded")): Promise<void> {
        const resolved = await this.resolvePluginFilename(fileID);
        if (this.isPluginLoaded(resolved)) throw new PluginAlreadyLoadedError(resolved);

        if (!(await this.allDependenciesSatisfied(resolved))) {
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            let dependencySatisfiedCallback: (value?: any) => void = () => { };
            const prom: Promise<undefined> = new Promise(res => dependencySatisfiedCallback = res);
            this.loadingQueue.push({
                plugin: fileID,
                callback: dependencySatisfiedCallback
            });
            await prom;
        }

        const plugin = await this.getPlugin(resolved, false);
        const pluginInfo = plugin.__meta;

        for (const [dependency, state] of Object.entries(pluginInfo.pluginDependencies || {})) {
            if (!this.dependencyTree[dependency]) this.dependencyTree[dependency] = {};
            this.dependencyTree[dependency][resolved] = (state as PluginDependency).state || state as ("started" | "loaded") || "started";
        }

        await injectDependencies(pluginInfo.dependencies || {});

        const storage = new Storage({
            path: resolve(this.storageDir, "plugins", parse(resolved).name + ".sqlite3"),
            metaTable: {
                Module: pluginInfo.name,
                Version: pluginInfo.version
            }
        });

        if (typeof plugin.load === "function") await plugin.load(this.api, storage, resolved);

        this.loadedPlugins[resolved] = plugin;
        setTimeout(() => {
            this.emit("pluginLoaded", resolved, {
                parent: false,
                pluginInfo
            });
            if (targetState === "started") this.startPlugin(resolved);
        }, 0);
    }

    async unloadPlugin(fileID: string): Promise<void> {
        const resolved = await this.resolvePluginFilename(fileID);
        if (!this.isPluginLoaded(resolved, false)) throw new PluginNotLoadedError(resolved);
        if (this.isPluginStarted(resolved, false)) throw new PluginStillStartedError(resolved);

        const plugin = await this.getPlugin(resolved, false);
        const pluginInfo = plugin.__meta;

        if (typeof plugin.unload === "function") await plugin.unload();

        delete this.loadedPlugins[resolved];

        setTimeout(() => {
            this.emit("pluginUnloaded", resolved, {
                parent: false,
                pluginInfo
            });
        }, 0);
    }

    async startPlugin(fileID: string): Promise<void> {
        const resolved = await this.resolvePluginFilename(fileID);
        if (!this.isPluginLoaded(resolved, false)) throw new PluginNotLoadedError(resolved);
        if (this.isPluginStarted(resolved, false)) throw new PluginAlreadyStartedError(resolved);

        const plugin = await this.getPlugin(resolved, false);
        const pluginInfo = plugin.__meta;

        if (typeof plugin.start === "function") await plugin.start();

        this.startedPlugins[resolved] = plugin;

        setTimeout(() => {
            this.emit("pluginStarted", resolved, {
                parent: false,
                pluginInfo
            });
        }, 0);
    }

    async stopPlugin(fileID: string): Promise<void> {
        const resolved = await this.resolvePluginFilename(fileID);
        if (!this.isPluginLoaded(resolved, false)) throw new PluginNotLoadedError(resolved);
        if (!this.isPluginStarted(resolved, false)) throw new PluginNotStartedError(resolved);

        const plugin = await this.getPlugin(resolved, false);
        const pluginInfo = plugin.__meta;

        if (typeof plugin.stop === "function") await plugin.stop();

        delete this.startedPlugins[resolved];

        setTimeout(() => {
            this.emit("pluginStopped", resolved, {
                parent: false,
                pluginInfo
            });
        }, 0);
    }

    async deleteStorage(fileID: string): Promise<void> {
        const resolved = await this.resolvePluginFilename(fileID);
        const isPluginLoaded = this.isPluginLoaded(resolved, false);
        const isPluginStarted = this.isPluginStarted(resolved, false);

        if (isPluginStarted) await this.stopPlugin(resolved);
        if (isPluginLoaded) await this.unloadPlugin(resolved);

        await fs.remove(resolve(this.storageDir, "plugins", parse(resolved).name + ".sqlite3"));

        if (isPluginLoaded) await this.loadPlugin(resolved);
        if (isPluginStarted) await this.startPlugin(resolved);
    }

}

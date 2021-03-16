"use strict";

import Storage from "./Storage";

export type PluginDependency = {
    state?: "started" | "loaded",
    optional?: boolean,
    version?: string
};

export type MetaInformation = {
    name: string,
    version: string,
    description: string,
    author: string | string[],
    apiVersion: string,
    dependencies?: {
        [key: string]: string
    },
    pluginDependencies?: {
        [key: string]: "started" | "loaded" | PluginDependency
    },
    stayLoadedOnDependencyLoss?: boolean
};

export default interface Plugin {
    __meta: MetaInformation;
    load?: (api: { [key: string]: any }, storage: Storage, fileID: string) => void | Promise<void>;
    start?: () => void | Promise<void>;
    stop?: () => void | Promise<void>;
    unload?: () => void | Promise<void>;
    API?: {
        [key: string]: (...args: any[]) => any;
    }
}

"use strict";

import ExtendableError from "./ExtendableError";

export class UnterminatedStringError extends ExtendableError {
    terminator: string;
    input: string;
    lineIndex: number;
    characterIndex: number;
    constructor(terminator: string, input: string, lineNr: number, characterNr: number) {
        super(
            `Missing ${terminator} to close quote starting on line ${lineNr + 1}, position ${characterNr + 1}:
${input.split("\n")[lineNr] || ""}
${(Array(characterNr).fill(" ").join(""))}^`);
        this.terminator = terminator;
        this.input = input;
        this.lineIndex = lineNr;
        this.characterIndex = characterNr;
    }
}
export class UnterminatedSingleQuoteError extends UnterminatedStringError {
    constructor(input: string, lineNr: number, characterNr: number) {
        super("'", input, lineNr, characterNr);
    }
}
export class UnterminatedDoubleQuoteError extends UnterminatedStringError {
    constructor(input: string, lineNr: number, characterNr: number) {
        super("\"", input, lineNr, characterNr);
    }
}
export class UnterminatedBacktickError extends UnterminatedStringError {
    constructor(input: string, lineNr: number, characterNr: number) {
        super("`", input, lineNr, characterNr);
    }
}
export class CommandNotFoundError extends ExtendableError {
    constructor(command: string) {
        super(`Command ${command} not found`);
    }
}

const nop = () => { /* no-op */ };

type env = {
    readonly [key: string]: string | undefined
} | ((key: string) => string);

export function split(inputString: string, customEnv: env = {}, replaceNotFoundVariables = false, throwErrorOnUnterminatedString = false): string[] {
    const DOUBLE_BACKSLASHES = "\u0000";
    const ESCAPED_DOUBLE_QUOTES = "\u0001";
    const ESCAPED_SINGLE_QUOTES = "\u0002";
    const ESCAPED_BACKTICKS = "\u0003";
    const ESCAPED_SPACES = "\u0004";
    const ESCAPED_DOLLAR_SIGNS = "\u0005";

    function escapeQuotes(input: string) {
        return input
            .replace(/\\\\/g, DOUBLE_BACKSLASHES)
            .replace(/\\"/g, ESCAPED_DOUBLE_QUOTES)
            .replace(/\\'/g, ESCAPED_SINGLE_QUOTES)
            .replace(/\\`/g, ESCAPED_BACKTICKS);
    }
    function unescapeQuotes(input: string) {
        return input
            .replace(new RegExp(DOUBLE_BACKSLASHES, "g"), "\\\\")
            .replace(new RegExp(ESCAPED_DOUBLE_QUOTES, "g"), "\\\"")
            .replace(new RegExp(ESCAPED_SINGLE_QUOTES, "g"), "\\'")
            .replace(new RegExp(ESCAPED_BACKTICKS, "g"), "\\`");
    }

    let input = inputString.replace(/\$/g, ESCAPED_DOLLAR_SIGNS);

    const variables = input.match(/\$(.+?)\b/g);
    if (customEnv && variables && variables.length) variables.forEach(variable => {
        const varName = variable.slice(1);
        const replacement = typeof customEnv === "function" ? customEnv(varName) : customEnv[varName];
        if (typeof replacement === "string" || replaceNotFoundVariables) input = input.replace(new RegExp(`\\$${varName}`, "g"), replacement || "");
    });

    input = escapeQuotes(input).replace(/\\ /g, ESCAPED_SPACES);

    const split = input.split(" ");

    const out: string[] = [];
    let quotingCharacter = "";
    let collectorArray: string[] = [];

    let line = 0;
    split.forEach(token => {
        if (token.includes("\n")) line += (token.match(/\n/g) || []).length;
        if (!quotingCharacter) {
            if (["\"", "'", "`"].includes(token.slice(0, 1))) {
                quotingCharacter = token.slice(0, 1);
                if (token.endsWith(quotingCharacter)) {
                    quotingCharacter = "";
                    out.push(token.slice(1, -1));
                } else {
                    collectorArray.push(token.slice(1));
                }
            } else {
                out.push(token);
            }
        } else {
            if (token.endsWith(quotingCharacter)) {
                quotingCharacter = "";
                collectorArray.push(token.slice(0, -1));
                out.push(collectorArray.join(" "));
                collectorArray = [];
            } else {
                collectorArray.push(token);
            }
        }
    });

    if (quotingCharacter && throwErrorOnUnterminatedString) {
        const error = quotingCharacter === "\"" ? UnterminatedDoubleQuoteError :
            quotingCharacter === "'" ? UnterminatedSingleQuoteError :
                quotingCharacter === "`" ? UnterminatedBacktickError : null;
        const linesUpToIndex = inputString.split("\n").slice(0, line).reverse();
        const lastLineWithQuotingCharacterIndex = linesUpToIndex
            .map(line => escapeQuotes(line))
            .findIndex(line => line.includes(quotingCharacter));
        const lastLineWithQuotingCharacter = escapeQuotes(linesUpToIndex[lastLineWithQuotingCharacterIndex] || "");
        let character = -1;
        if (lastLineWithQuotingCharacter) {
            const preQuoteChar = lastLineWithQuotingCharacter.slice(0, lastLineWithQuotingCharacter.lastIndexOf(quotingCharacter));
            character = unescapeQuotes(preQuoteChar).length;
        }
        const compareLn = unescapeQuotes(lastLineWithQuotingCharacter || "");
        const lineNumber = inputString.split("\n").findIndex(ln => ln === compareLn);
        if (error) throw new error(inputString, lineNumber, character);
        else throw new UnterminatedStringError(quotingCharacter, inputString, lineNumber, character);
    }

    out.push(collectorArray.join(" "));

    return out.filter(i => i).map(line =>
        unescapeQuotes(line)
            .replace(new RegExp(ESCAPED_SPACES, "g"), " ")
            .replace(new RegExp(ESCAPED_DOLLAR_SIGNS, "g"), "$")
    );
}

const selfCommand = new WeakMap();
const commandDescription = new WeakMap();
const parentContainer = new WeakMap();
const permissionString = new WeakMap();

export class CommandContainer {
    #hookedCommands: {
        [key: string]: {
            command: Command,
            description: string
        }
    } = {};
    #commandAliases: {
        [key: string]: string
    } = {};
    #aliasArray: {
        [key: string]: string[]
    } = {};
    #helpText: string | null = null;

    destroy(): void {
        this.#hookedCommands = {};
        this.#aliasArray = {};
        this.#commandAliases = {};
    }

    addCommand(command: string, description = "", aliases: string | string[] = [], permissionFlag = ""): Command | null {
        if (!command) return null;
        command = command.toLowerCase();
        this.#aliasArray[command] = [];
        if (typeof aliases === "string") aliases = [aliases];
        if (Array.isArray(aliases)) aliases.filter(i => i).forEach(alias => {
            alias = alias.toLowerCase();
            this.#commandAliases[alias] = command;
            this.#aliasArray[command].push(alias);
        });

        const cmd = new Command();

        selfCommand.set(cmd, command);
        commandDescription.set(cmd, description);
        parentContainer.set(cmd, this);
        permissionString.set(cmd, permissionFlag);

        this.#hookedCommands[command] = {
            command: cmd,
            description
        };

        return cmd;
    }

    removeCommand(command: string): this {
        if (!command) return this;
        command = command.toLowerCase();
        while (this.#commandAliases[command]) command = this.#commandAliases[command];
        if (this.#hookedCommands[command]) return this;
        this.#hookedCommands[command].command.destroy();
        delete this.#hookedCommands[command];
        this.#aliasArray[command].forEach(alias => delete this.#commandAliases[alias]);
        delete this.#aliasArray[command];
        return this;
    }

    getCommands(): {
        [key: string]: {
            command: Command,
            description: string
        }
    } {
        return this.#hookedCommands;
    }

    getCommand(command: string): Command | null {
        if (!command) return null;
        command = command.toLowerCase();
        while (this.#commandAliases[command]) command = this.#commandAliases[command];
        if (!this.#hookedCommands[command]) return null;
        return this.#hookedCommands[command].command;
    }

    setHelp(helpText: string | null): this {
        if (helpText) this.#helpText = helpText;
        else this.#helpText = null;
        return this;
    }

    getHelp(): string {
        if (this.#helpText) return this.#helpText;
        const allCmds = this.getCommands();
        return (selfCommand.get(this) ? selfCommand.get(this) + " - " + commandDescription.get(this) + "\n\n" : "") +
            Object.keys(allCmds).reduce((result: string[], item) => {
                if (allCmds[item].description)
                    result.push(
                        (allCmds[item].command.getSyntax() ? allCmds[item].command.getSyntax() : item) +
                        " - " + allCmds[item].description
                    );
                return result;
            }, []).join("\n");
    }

    getAliasesForCommand(command: string): string[] {
        if (typeof command !== "string" || !command) return [];
        command = command.toLowerCase();
        if (!this.#aliasArray[command]) return [];
        return this.#aliasArray[command];
    }
    addAliasToCommand(command: string, alias: string): this {
        if (typeof command !== "string" || !command || typeof alias !== "string" || !alias) return this;
        command = command.toLowerCase();
        alias = alias.toLowerCase();
        if (this.#aliasArray[command].indexOf(alias) === -1) {
            this.#aliasArray[command].push(alias);
            this.#commandAliases[alias] = command;
        }
        return this;
    }
    removeAliasFromCommand(command: string, alias: string): this {
        if (typeof command !== "string" || !command || typeof alias !== "string" || !alias) return this;
        command = command.toLowerCase();
        alias = alias.toLowerCase();
        if (this.#aliasArray[command].indexOf(alias) !== -1) {
            this.#aliasArray[command].splice(this.#aliasArray[command].indexOf(alias), 1);
            delete this.#commandAliases[alias];
        }
        return this;
    }

    resolve(rawCommandString: string, env: env = {}): { command: Command, args: string[], simpleArgs: string[] } | null {
        const args = split(rawCommandString, env);
        const cmd = args.shift();
        if (!cmd) return null;
        let resolvedCommand = this.getCommand(cmd || "");
        if (!resolvedCommand) return null;
        let tmp: Command | null = resolvedCommand;
        let tmpArg = "";
        let simpleCommandString = rawCommandString.substr(cmd.length + 1);
        while (tmp) {
            resolvedCommand = tmp;
            tmpArg = args.shift() || "";
            tmp = tmp.getCommand(tmpArg);
            if (tmp) simpleCommandString = simpleCommandString.substr(tmpArg.length + 1);
        }
        if (tmpArg) args.unshift(tmpArg);
        return {
            command: resolvedCommand,
            args,
            simpleArgs: simpleCommandString.trim().split(" ")
        };
    }

    resolveAndRun(rawCommandString: string, env: env = {}): any {
        const resolved = this.resolve(rawCommandString);
        if (resolved) return resolved.command.run.call(resolved.command, resolved.args, resolved.simpleArgs);
    }
}

class Command extends CommandContainer {
    #callback: ((...args: any[]) => any);
    #syntax: string | null = null;
    constructor() {
        super();
        this.#callback = function () {
            // A default function that should be changed by calling
            // setFunction(callback) on the command object
            // It prints the attached help by default
            console.log(this.getHelp());
        };
    }
    destroy(): void {
        super.destroy();
        selfCommand.delete(this);
        commandDescription.delete(this);
        parentContainer.delete(this);
        permissionString.delete(this);
    }

    getSelfCommand(): string {
        return selfCommand.get(this);
    }

    getParentCommandContainer(): CommandContainer {
        return parentContainer.get(this) || this;
    }

    setFunction(callback: (...args: any[]) => any): this {
        if (typeof callback !== "function") return this;
        this.#callback = callback || nop;
        return this;
    }

    setSyntax(syntaxString: string | null): this {
        if (syntaxString && typeof syntaxString === "string") this.#syntax = syntaxString;
        else this.#syntax = null;
        return this;
    }
    getSyntax(): string {
        return this.#syntax || "";
    }

    setPermission(permissionData: string | any): this {
        permissionString.set(this, permissionData);
        return this;
    }
    getPermission(): any {
        return permissionString.get(this);
    }

    getAliases(): string[] {
        return super.getAliasesForCommand.call(this.getParentCommandContainer(), this.getSelfCommand());
    }
    addAlias(alias: string): this {
        super.addAliasToCommand.call(this.getParentCommandContainer(), this.getSelfCommand(), alias);
        return this;
    }
    removeAlias(alias: string): this {
        super.removeAliasFromCommand.call(this.getParentCommandContainer(), this.getSelfCommand(), alias);
        return this;
    }

    delete(): null {
        this.getParentCommandContainer().removeCommand(this.getSelfCommand());
        this.destroy();
        return null;
    }

    run(...args: any[]): any {
        return this.#callback.call(this, ...args);
    }
}

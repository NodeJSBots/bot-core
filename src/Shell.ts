"use strict";

import repl from "repl";
import CommandContainer, { CommandNotFoundError, UnterminatedStringError } from "./Commands";
import { Readable, Writable } from "stream";
import { REPLEval, ReplOptions, REPLServer, REPLWriter } from "repl";
import { inspect } from "util";
import { Completer } from "readline";
import { homedir } from "os";
import { resolve } from "path";

export default class Shell {
    #container: CommandContainer;
    #repl: REPLServer;

    constructor(commandContainer: CommandContainer, shellOptions: {
        prompt?: string,
        input?: Readable,
        output?: Writable,
        writer?: REPLWriter,
        historyFilepath?: string | null
    } = {
            prompt: "> ",
            input: process.stdin,
            output: process.stdout,
            writer: inspect,
            historyFilepath: resolve(homedir(), ".extendable-bot-core-history")
        }) {
        this.#container = commandContainer;

        const evalFn: REPLEval = async (cmd, context, file, cb) => {
            try {
                if (!commandContainer.resolve(cmd)) throw new CommandNotFoundError(cmd);
                cb(null, await commandContainer.resolveAndRun(cmd));
            } catch (error) {
                if (error instanceof UnterminatedStringError) cb(new repl.Recoverable(error), null);
                else cb(error, null);
            }
        };

        const completerFn: Completer = (line) => {
            const cmd = commandContainer.resolve(line);
            if (!cmd) return [[], line];
            const matchStr = cmd.args[0] || "";
            const subCommands = Object.keys(cmd.command.getCommands());
            const completions = subCommands.filter(key => key.includes(matchStr.toLowerCase()));
            return [completions.length ? completions : subCommands, matchStr];
        };

        const replOpts: ReplOptions = {
            prompt: shellOptions.prompt,
            input: shellOptions.input,
            output: shellOptions.output,
            writer: shellOptions.writer,
            eval: evalFn,
            completer: completerFn
        };

        this.#repl = repl.start(replOpts);

        if (shellOptions.historyFilepath) this.#repl.setupHistory(shellOptions.historyFilepath, (err) => console.warn(err));
    }

    close(): void {
        this.#repl.close();
    }
}

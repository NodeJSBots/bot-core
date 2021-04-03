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


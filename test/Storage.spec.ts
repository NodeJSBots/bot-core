"use strict";
const TEST_SUITE = "Storage";

import { resolve } from "path";
import fs from "fs-extra";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);
const { expect } = chai;
import { TEST_DIRECTORY } from "./const";
const DIR = resolve(TEST_DIRECTORY, TEST_SUITE);

// Mock Data
const randomFloat = Math.random();
const randomString = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
const randomBoolean = Math.random() < 0.5;
const randomNull = null;
const randomArray: number[] = [];
const randomDefaultValue = Math.floor(Math.random() * 128);

import Storage from "../src/Storage";
describe(TEST_SUITE, function () {
    before(async function () {
        await fs.mkdirp(DIR);
    });
    // eslint-disable-next-line
    const DB_PATH = resolve(DIR, "StorageTest.db");

    describe("Initialisation", function () {
        it("Throws an error with an inaccessible path", function () {
            expect(() =>
                new Storage({
                    path: resolve(DIR, "INVALID_DIRECTORY", "StorageTest.db")
                })
            ).to.throw();
            expect(() =>
                new Storage(resolve(DIR, "INVALID_DIRECTORY", "StorageTest.db"))
            ).to.throw();
        });

        it("Create an in-memory database", function () {
            expect(
                new Storage("")
            ).to.be.instanceOf(Storage);
            expect(
                new Storage({
                    path: ""
                })
            ).to.be.instanceOf(Storage);
            expect(
                new Storage(":memory:")
            ).to.be.instanceOf(Storage);
            expect(
                new Storage({
                    path: ":memory:"
                })
            ).to.be.instanceOf(Storage);
        });

        it("Create and close a file-based database", async function () {
            let store = new Storage(DB_PATH);
            expect(store).to.be.instanceOf(Storage);
            await store.__destroy();
            await fs.remove(DB_PATH);
            store = new Storage({
                path: DB_PATH
            });
            expect(store).to.be.instanceOf(Storage);
            await store.__destroy();
            await fs.remove(DB_PATH);
        });
    });
    describe("Storing and retrieving data", function () {
        let storage: Storage = new Storage("");

        it("Init test data", function () {
            storage = new Storage(DB_PATH);
            for (let i = 0; i === Math.floor(Math.random() * 32); i++)
                randomArray.push(Math.random());
        });
        it("Writes and reads back a number value", function () {
            storage.setItem("random_value_test_number", randomFloat);
            expect(storage.getItem("random_value_test_number")).to.equal(randomFloat);
        });
        it("Writes and reads back a string value", function () {
            storage.setItem("random_value_test_string", randomString);
            expect(storage.getItem("random_value_test_string")).to.equal(randomString);
        });
        it("Writes and reads back a boolean value", function () {
            storage.setItem("random_value_test_boolean", randomBoolean);
            expect(storage.getItem("random_value_test_boolean")).to.equal(randomBoolean);
        });
        it("Writes and reads back a null value", function () {
            storage.setItem("random_value_test_null", randomNull);
            expect(storage.getItem("random_value_test_null")).to.equal(randomNull);
        });
        it("Writes and reads back an array value", function () {
            storage.setItem("random_value_test_array", randomArray);
            expect(storage.getItem("random_value_test_array")).to.deep.equal(randomArray);
        });
        it("Writes and reads back an object value", function () {
            storage.setItem("random_value_test_object", {
                randomFloat,
                randomString,
                randomBoolean,
                randomNull,
                randomArray
            });
            expect(storage.getItem("random_value_test_object")).to.deep.equal({
                randomFloat,
                randomString,
                randomBoolean,
                randomNull,
                randomArray
            });
        });
        it("Reads a defaultValue in case of an non-existing key", function () {
            expect(storage.hasItem("this_key_does_not_exist")).to.equal(false);
            expect(storage.getItem("this_key_does_not_exist", randomDefaultValue)).to.equal(randomDefaultValue);
        });
        it("Closes and re-opens the database, retaining all previously saved values", function () {
            storage.__destroy();
            storage = new Storage(DB_PATH);
            expect(storage.getItem("random_value_test_number")).to.equal(randomFloat);
            expect(storage.getItem("random_value_test_string")).to.equal(randomString);
            expect(storage.getItem("random_value_test_boolean")).to.equal(randomBoolean);
            expect(storage.getItem("random_value_test_null")).to.equal(randomNull);
            expect(storage.getItem("random_value_test_array")).to.deep.equal(randomArray);
            expect(storage.getItem("random_value_test_object")).to.deep.equal({
                randomFloat,
                randomString,
                randomBoolean,
                randomNull,
                randomArray
            });
        });
        it("Returns all saved keys in proper order", function () {
            expect(storage.keys).to.deep.equal([
                "random_value_test_number",
                "random_value_test_string",
                "random_value_test_boolean",
                "random_value_test_null",
                "random_value_test_array",
                "random_value_test_object"
            ]);
        });
        it("Closes the Storage", function () {
            expect(() => storage.__destroy()).to.not.throw();
        });
    });
});

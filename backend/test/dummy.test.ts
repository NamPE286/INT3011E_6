import { beforeEach, describe, expect, it } from "bun:test";
import { app } from "../src/app";
import { createMockEnv, type MockEnvironment } from "./mocks";

describe("dummy database route", () => {
    let mockEnv: MockEnvironment;

    beforeEach(() => {
        mockEnv = createMockEnv();
    });

    it("fetches the seeded dummy row through Drizzle", async () => {
        const request = new Request("http://localhost/api/dummy");
        (request as unknown as { env: unknown }).env = mockEnv;

        const response = await app.handle(request);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            id: 1,
            message: "Drizzle is connected",
        });
    });
});

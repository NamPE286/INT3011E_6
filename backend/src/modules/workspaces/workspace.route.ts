import { Elysia, t } from "elysia";
import { getAuthSession } from "../../plugins/auth";
import { extractEnvFromRequest } from "../../plugins/context";
import { createWorkspace, deleteWorkspace, listWorkspacesForUser, updateWorkspace } from "./workspace.service";

export const workspaceModule = new Elysia({ prefix: "/api" })
    .get("/workspaces", async ({ request, set }) => {
        const env = extractEnvFromRequest(request);

        if (!env?.DB) {
            set.status = 503;

            return { message: "Database service unavailable" };
        }

        const session = await getAuthSession(env, request);

        if (!session) {
            set.status = 401;

            return { message: "Vui lòng đăng nhập để xem không gian làm việc" };
        }

        const workspaces = await listWorkspacesForUser(env.DB, session.user.id);

        return { workspaces };
    })
    .post(
        "/workspaces",
        async ({ body, request, set }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const session = await getAuthSession(env, request);

            if (!session) {
                set.status = 401;

                return { message: "Vui lòng đăng nhập để tạo không gian làm việc" };
            }

            const name = body.name.trim();

            if (name.length === 0) {
                set.status = 400;

                return { message: "Tên không gian làm việc không được để trống" };
            }

            const workspace = await createWorkspace(env.DB, session.user.id, {
                name,
                description: body.description,
                domain: body.domain,
                seedSample: body.seedSample === true,
            });

            set.status = 201;

            return { workspace };
        },
        {
            body: t.Object({
                name: t.String({ minLength: 1, maxLength: 120 }),
                description: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
                domain: t.Optional(t.String({ maxLength: 50 })),
                seedSample: t.Optional(t.Boolean()),
            }),
        },
    )
    .patch(
        "/workspaces/:workspaceId",
        async ({ params, body, request, set }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const session = await getAuthSession(env, request);

            if (!session) {
                set.status = 401;

                return { message: "Vui lòng đăng nhập để cập nhật không gian làm việc" };
            }

            const updated = await updateWorkspace(env.DB, session.user.id, params.workspaceId, {
                name: body.name,
                description: body.description,
                domain: body.domain,
            });

            if (!updated) {
                set.status = 404;

                return { message: "Không tìm thấy không gian làm việc" };
            }

            return { workspace: updated };
        },
        {
            params: t.Object({
                workspaceId: t.String(),
            }),
            body: t.Object({
                name: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
                description: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
                domain: t.Optional(t.String({ maxLength: 50 })),
            }),
        },
    )
    .delete(
        "/workspaces/:workspaceId",
        async ({ params, request, set }) => {
            const env = extractEnvFromRequest(request);

            if (!env?.DB) {
                set.status = 503;

                return { message: "Database service unavailable" };
            }

            const session = await getAuthSession(env, request);

            if (!session) {
                set.status = 401;

                return { message: "Vui lòng đăng nhập để xóa không gian làm việc" };
            }

            const deleted = await deleteWorkspace(env.DB, session.user.id, params.workspaceId);

            if (!deleted) {
                set.status = 404;

                return { message: "Không tìm thấy không gian làm việc" };
            }

            return { deleted: true };
        },
        {
            params: t.Object({
                workspaceId: t.String(),
            }),
        },
    );

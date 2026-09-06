import { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate";
import { CreateTaskSchema, UpdateTaskSchema, UpdateTaskStatusSchema, ListTasksQuery } from "./tasks.schemas";
import { createTask, listTasks, getTask, getMyTasks, updateTask, updateTaskStatus, deleteTask } from "./tasks.service";

export async function tasksRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  app.get("/", async (req, reply) => reply.send({ data: await listTasks(ListTasksQuery.parse(req.query)) }));
  app.get("/mine", async (req, reply) => reply.send({ data: await getMyTasks(req.user.sub, (req.query as any).status as string | undefined) }));
  app.get("/:id", async (req, reply) => reply.send({ data: await getTask((req.params as { id: string }).id) }));
  app.post("/", async (req, reply) => reply.status(201).send({ data: await createTask(req.user.sub, CreateTaskSchema.parse(req.body)) }));

  app.patch("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdateTaskSchema.parse(req.body);
    const keys = Object.keys(body).filter(k => (body as any)[k] !== undefined);
    // Backwards-compatible lifecycle call: status-only means pause/resume. A creator
    // cannot combine status with content edits, and cannot submit protected states.
    if (keys.length === 1 && body.status) return reply.send({ data: await updateTaskStatus(req.user.sub, id, body.status) });
    if (body.status) throw Object.assign(new Error("Status cannot be changed together with task content"), { statusCode: 400, code: "INVALID_STATUS_MUTATION" });
    return reply.send({ data: await updateTask(req.user.sub, id, body) });
  });

  app.patch("/:id/status", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdateTaskStatusSchema.parse(req.body);
    return reply.send({ data: await updateTaskStatus(req.user.sub, id, body.status) });
  });

  app.delete("/:id", async (req, reply) => {
    await deleteTask(req.user.sub, (req.params as { id: string }).id);
    return reply.status(204).send();
  });
}

import { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate";
import { CreateTaskSchema, UpdateTaskSchema, UpdateTaskStatusSchema, ListTasksQuery } from "./tasks.schemas";
import { createTask, listTasks, getTask, getMyTasks, updateTask, updateTaskStatus, deleteTask } from "./tasks.service";

export async function tasksRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  app.get("/", async (req, reply) => {
    const q = ListTasksQuery.parse(req.query);
    return reply.send({ data: await listTasks(q) });
  });

  app.get("/mine", async (req, reply) => {
    const q = (req.query as any).status as string | undefined;
    return reply.send({ data: await getMyTasks(req.user.sub, q) });
  });

  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ data: await getTask(id) });
  });

  app.post("/", async (req, reply) => {
    const body = CreateTaskSchema.parse(req.body);
    return reply.status(201).send({ data: await createTask(req.user.sub, body) });
  });

  // Content edits are intentionally separate from lifecycle control. The service
  // forces every content edit back to pending_review.
  app.patch("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdateTaskSchema.parse(req.body);
    return reply.send({ data: await updateTask(req.user.sub, id, body) });
  });

  // Creator lifecycle control is limited to active <-> paused. Protected review,
  // approval and rejection states cannot be supplied by the creator.
  app.patch("/:id/status", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdateTaskStatusSchema.parse(req.body);
    return reply.send({ data: await updateTaskStatus(req.user.sub, id, body.status) });
  });

  app.delete("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await deleteTask(req.user.sub, id);
    return reply.status(204).send();
  });
}

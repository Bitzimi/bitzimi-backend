import { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate";
import { CreateTaskSchema, UpdateTaskSchema, ListTasksQuery } from "./tasks.schemas";
import { createTask, listTasks, getTask, getMyTasks, updateTask, deleteTask } from "./tasks.service";

export async function tasksRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authenticate);

  // GET /api/v1/tasks — active marketplace listing
  app.get("/", async (req, reply) => {
    const q = ListTasksQuery.parse(req.query);
    return reply.send({ data: await listTasks(q) });
  });

  // GET /api/v1/tasks/mine — advertiser's own tasks
  app.get("/mine", async (req, reply) => {
    const q = (req.query as any).status as string | undefined;
    return reply.send({ data: await getMyTasks(req.user.sub, q) });
  });

  // GET /api/v1/tasks/:id — task detail + reference screenshots
  app.get("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ data: await getTask(id) });
  });

  // POST /api/v1/tasks — create task (deducts budget from main → task_vault)
  app.post("/", async (req, reply) => {
    const body = CreateTaskSchema.parse(req.body);
    return reply.status(201).send({ data: await createTask(req.user.sub, body) });
  });

  // PATCH /api/v1/tasks/:id — update own task
  app.patch("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdateTaskSchema.parse(req.body);
    return reply.send({ data: await updateTask(req.user.sub, id, body) });
  });

  // DELETE /api/v1/tasks/:id — delete pending task, returns budget
  app.delete("/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await deleteTask(req.user.sub, id);
    return reply.status(204).send();
  });
}

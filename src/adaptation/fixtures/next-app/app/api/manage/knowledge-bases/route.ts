import { z } from 'zod';

const CreateKnowledgeBaseSchema = z.object({
  name: z.string().min(1),
});

export async function GET() {
  return [{ status: 401 }, { status: 403 }];
}

export async function POST(request: Request) {
  const payload = await request.json();
  CreateKnowledgeBaseSchema.parse(payload);

  return [{ status: 201 }, { status: 400 }];
}

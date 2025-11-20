import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { promptPresets } from "@/lib/ai/prompt-presets";
import { db } from "@/lib/db/queries";
import { promptTemplate } from "@/lib/db/schema";

const createPromptSchema = z.object({
  name: z.string().min(1).max(100),
  prompt: z.string().min(1),
});

// GET all prompt templates (presets + user's custom templates)
export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    // Get user's custom templates
    const customTemplates = await db
      .select()
      .from(promptTemplate)
      .where(eq(promptTemplate.userId, session.user.id));

    // Combine presets with custom templates
    const allTemplates = [
      ...promptPresets.map((preset) => ({
        id: preset.id,
        name: preset.name,
        prompt: preset.prompt,
        description: preset.description,
        isDefault: true,
        isPreset: true,
      })),
      ...customTemplates.map((template) => ({
        id: template.id,
        name: template.name,
        prompt: template.prompt,
        isDefault: template.isDefault,
        isPreset: false,
        createdAt: template.createdAt,
      })),
    ];

    return Response.json(allTemplates);
  } catch (error) {
    console.error("Error fetching prompt templates:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

// POST create a new custom prompt template
export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();
    const validation = createPromptSchema.safeParse(body);

    if (!validation.success) {
      return Response.json(
        { error: "Invalid input", details: validation.error.issues },
        { status: 400 }
      );
    }

    const { name, prompt } = validation.data;

    const [newTemplate] = await db
      .insert(promptTemplate)
      .values({
        userId: session.user.id,
        name,
        prompt,
      })
      .returning();

    return Response.json(newTemplate, { status: 201 });
  } catch (error) {
    console.error("Error creating prompt template:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

// DELETE a custom prompt template
export async function DELETE(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const templateId = searchParams.get("id");

    if (!templateId) {
      return Response.json({ error: "Template ID required" }, { status: 400 });
    }

    // Don't allow deletion of presets (they're not in the database)
    const preset = promptPresets.find((p) => p.id === templateId);
    if (preset) {
      return Response.json(
        { error: "Cannot delete preset templates" },
        { status: 400 }
      );
    }

    await db
      .delete(promptTemplate)
      .where(
        and(
          eq(promptTemplate.id, templateId),
          eq(promptTemplate.userId, session.user.id)
        )
      );

    return Response.json({ success: true });
  } catch (error) {
    console.error("Error deleting prompt template:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}

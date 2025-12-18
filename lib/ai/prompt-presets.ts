export type PromptPreset = {
  id: string;
  name: string;
  prompt: string;
  description?: string;
  icon: "user" | "code" | "writer" | "teacher" | "research" | "analyst" | "technical";
};

export const promptPresets: PromptPreset[] = [
  {
    id: "default",
    name: "Default Assistant",
    prompt: "You are a helpful AI assistant.",
    description: "General-purpose assistant",
    icon: "user",
  },
  {
    id: "code",
    name: "Code Expert",
    prompt: "You are an expert programmer...",
    description: "Specialized in programming",
    icon: "code",
  },
  {
    id: "writer",
    name: "Creative Writer",
    prompt: "You are a creative writing assistant...",
    description: "Perfect for creative writing",
    icon: "writer",
  },
  {
    id: "teacher",
    name: "Patient Teacher",
    prompt: "You are a patient teacher...",
    description: "Educational assistant",
    icon: "teacher",
  },
  {
    id: "researcher",
    name: "Research Assistant",
    prompt: "You are a research assistant...",
    description: "Focused on research",
    icon: "research",
  },
  {
    id: "analyst",
    name: "Business Analyst",
    prompt: "You are a business analyst...",
    description: "Business strategy specialist",
    icon: "analyst",
  },
  {
    id: "technical-writer",
    name: "Technical Writer",
    prompt: "You are a technical writer...",
    description: "Documentation expert",
    icon: "technical",
  },
];

export function getPresetById(id: string): PromptPreset | undefined {
  return promptPresets.find((preset) => preset.id === id);
}

export function getPresetPrompt(id: string): string {
  const preset = getPresetById(id);
  return preset?.prompt || promptPresets[0].prompt;
}

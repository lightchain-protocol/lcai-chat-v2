"use client";

import { Plus } from "lucide-react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetcher } from "@/lib/utils";

export type PromptTemplate = {
  id: string;
  name: string;
  prompt: string;
  description?: string;
  isDefault?: boolean;
  isPreset?: boolean;
};

type SystemPromptSelectorProps = {
  value?: string;
  onChange: (promptId: string, prompt: string) => void;
  onCreateNew?: () => void;
  disabled?: boolean;
};

export function SystemPromptSelector({
  value,
  onChange,
  onCreateNew,
  disabled = false,
}: SystemPromptSelectorProps) {
  const { data: templates = [] } = useSWR<PromptTemplate[]>(
    "/api/prompts",
    fetcher
  );

  const handleValueChange = (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    if (template) {
      onChange(template.id, template.prompt);
    }
  };

  const presetTemplates = templates.filter((t) => t.isPreset);
  const customTemplates = templates.filter((t) => !t.isPreset);

  return (
    <div className="flex items-center gap-2">
      <Select
        disabled={disabled}
        onValueChange={handleValueChange}
        value={value || "default"}
      >
        <SelectTrigger className="w-full border border-bdr-soft bg-surface-base-faint rounded-xl">
          <SelectValue placeholder="Select a prompt..." />
        </SelectTrigger>
        <SelectContent className="!max-h-75 overflow-y-auto">
          {presetTemplates.length > 0 && (
            <SelectGroup>
              <SelectLabel>Presets</SelectLabel>
              {presetTemplates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  <div className="flex flex-col items-start text-left">
                    <div className="font-medium">{template.name}</div>
                    {template.description && (
                      <div className="whitespace-normal text-muted-foreground text-xs">
                        {template.description}
                      </div>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectGroup>
          )}

          {customTemplates.length > 0 && (
            <>
              {presetTemplates.length > 0 && <SelectSeparator />}
              <SelectGroup>
                <SelectLabel>Custom</SelectLabel>
                {customTemplates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    <div className="flex flex-col items-start text-left">
                      <h6 className="font-medium text-content-strong">{template.name}</h6>
                      <p className="line-clamp-3 whitespace-normal text-content-default text-xs">
                        {template.prompt}
                      </p>
                    </div>
                  </SelectItem>
                ))}
              </SelectGroup>
            </>
          )}
        </SelectContent>
      </Select>

      {onCreateNew && (
        <Button
          disabled={disabled}
          onClick={onCreateNew}
          size="icon"
          title="Create custom prompt"
          variant="outline"
          className="px-4 border border-bdr-soft bg-surface-base-faint"
        >
          <Plus className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

"use client";

import {
  ChartCandlestick,
  ChevronRight,
  CodeXml,
  GraduationCap,
  Microscope,
  Pencil,
  PencilRuler,
  Settings,
  UserPen,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { $http } from "@/lib/http";
import { DialogClose } from "./ui/dialog";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";

const ICON_MAP = {
  user: UserPen,
  code: CodeXml,
  writer: Pencil,
  teacher: GraduationCap,
  research: Microscope,
  analyst: ChartCandlestick,
  technical: PencilRuler,
} as const;

export type PromptTemplate = {
  id: string;
  name: string;
  prompt: string;
  description?: string;
  isDefault?: boolean;
  isPreset?: boolean;
  icon?: keyof typeof ICON_MAP;
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
  const { status: sessionStatus, data } = useSession();

  const { data: templates = [] } = useSWR<PromptTemplate[]>(
    sessionStatus === "authenticated" ? "/api/prompts" : null,
    async (url: string) => {
      const response = await $http.get(url, {
        headers: {
          Authorization: `Bearer ${data?.user.token}`,
        },
      });
      if (!response.ok) return null;
      return response.json();
    },
  );

  const [selectedId, setSelectedId] = useState<string | undefined>(value);

  const presetTemplates = templates.filter((t) => t.isPreset);
  const customTemplates = templates.filter((t) => !t.isPreset);

  const handleSave = () => {
    const template = templates.find((t) => t.id === selectedId);
    if (template) {
      onChange(template.id, template.prompt);
    }
  };

  return (
    <div className="space-y-5">
      {onCreateNew && (
        <button
          className="grid w-full grid-cols-[1fr_20px] items-center gap-5 rounded-2xl border border-bdr-extraLight bg-surface-base-subtle py-4 pr-6 pl-4 hover:bg-surface-base-faint"
          disabled={disabled}
          onClick={onCreateNew}
          type="button"
        >
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-bdr-light bg-surface-elevation-light text-content-default">
              <Settings size={20} />
            </span>
            <div className="text-left">
              <h6 className="-tracking-[0.096px] font-semibold text-content-strong leading-[1.2]">
                Custom
              </h6>
              <p className="mt-0.5 text-content-default text-sm">
                Create a custom system prompt.
              </p>
            </div>
          </div>
          <ChevronRight className="text-content-medium" size={24} />
        </button>
      )}

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
        <span className="h-px w-full bg-surface-base-extraLight" />
        <span className="text-content-medium text-sm">Or</span>
        <span className="h-px w-full bg-surface-base-extraLight" />
      </div>

      <div className="border-bdr-extraLight border-b pb-1">
        <RadioGroup
          className="-mx-2.5 max-h-100 space-y-4 overflow-y-auto px-2.5"
          disabled={disabled}
          onValueChange={setSelectedId}
          value={selectedId}
        >
          {/* Presets */}
          {presetTemplates.length > 0 && (
            <div className="space-y-3">
              <h6 className="font-medium text-content-soft text-sm">
                Choose from presets
              </h6>

              {presetTemplates.map((template) => {
                const Icon = template.icon ? ICON_MAP[template.icon] : null;

                return (
                  <RadioGroupItem
                    className="after:-translate-y-1/2 relative grid w-full cursor-pointer grid-cols-[1fr_20px] items-center gap-5 rounded-2xl border border-bdr-extraLight p-4 transition-colors duration-200 after:absolute after:top-1/2 after:right-4 after:size-5 after:rounded-full after:border-5 after:border-transparency-dark-mode-24 after:shadow-[0_1.364px_2.727px_rgba(10,13,20,0.03)] after:content-[''] hover:border-surface-base-brand-default data-[state=checked]:border-surface-base-brand-default data-[state=checked]:after:border-surface-base-brand-strong"
                    id={template.id}
                    key={template.id}
                    value={template.id}
                  >
                    <div className="flex items-center gap-3 text-left">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-bdr-light bg-surface-elevation-light text-content-default">
                        {Icon && <Icon size={20} />}
                      </span>
                      <div>
                        <h6 className="-tracking-[0.096px] font-semibold text-content-strong leading-[1.2]">
                          {template.name}
                        </h6>
                        {template.description && (
                          <p className="mt-0.5 font-normal text-content-default text-sm">
                            {template.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </RadioGroupItem>
                );
              })}
            </div>
          )}

          {/* Custom */}
          {customTemplates.length > 0 && (
            <div className="space-y-3">
              <h6 className="font-medium text-content-soft text-sm">Custom</h6>

              {customTemplates.map((template) => (
                <RadioGroupItem
                  className="after:-translate-y-1/2 relative grid w-full cursor-pointer grid-cols-[1fr_20px] items-center gap-5 rounded-2xl border border-bdr-extraLight p-4 transition-colors duration-200 after:absolute after:top-1/2 after:right-4 after:size-5 after:rounded-full after:border-5 after:border-transparency-dark-mode-24 after:shadow-[0_1.364px_2.727px_rgba(10,13,20,0.03)] after:content-[''] hover:border-surface-base-brand-default data-[state=checked]:border-surface-base-brand-default data-[state=checked]:after:border-surface-base-brand-strong"
                  id={template.id}
                  key={template.id}
                  value={template.id}
                >
                  <div className="flex items-center gap-3 text-left">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-bdr-light bg-surface-elevation-light text-content-default">
                      <Settings size={20} />
                    </span>
                    <div>
                      <h6 className="-tracking-[0.096px] font-semibold text-content-strong leading-[1.2]">
                        {template.name}
                      </h6>
                      {template.prompt && (
                        <p className="mt-0.5 font-normal text-content-default text-sm">
                          {template.prompt}
                        </p>
                      )}
                    </div>
                  </div>
                </RadioGroupItem>
              ))}
            </div>
          )}
        </RadioGroup>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button
          className="text-sm"
          disabled={!selectedId || disabled}
          onClick={handleSave}
          variant="gradient"
        >
          Save Prompt
        </Button>
      </div>
    </div>
  );
}

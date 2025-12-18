"use client";

import { ChevronRight, Settings } from "lucide-react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { fetcher } from "@/lib/utils";
import { useState } from "react";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { DialogClose } from "./ui/dialog";
import {
  UserPen,
  CodeXml,
  Pencil,
  GraduationCap,
  Microscope,
  ChartCandlestick,
  PencilRuler,
} from "lucide-react";

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
  const { data: templates = [] } = useSWR<PromptTemplate[]>(
    "/api/prompts",
    fetcher
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
          disabled={disabled}
          onClick={onCreateNew}
          className="grid grid-cols-[1fr_20px] items-center gap-5 w-full py-4 pl-4 pr-6 rounded-2xl border border-bdr-extraLight bg-surface-base-subtle hover:bg-surface-base-faint"
        >
          <div className="flex items-center gap-3">
            <span className="text-content-default size-11 flex items-center justify-center rounded-full border border-bdr-light bg-surface-elevation-light shrink-0">
              <Settings size={20} />
            </span>
            <div className="text-left">
              <h6 className="text-content-strong font-semibold -tracking-[0.096px] leading-[1.2]">Custom</h6>
              <p className="text-sm text-content-default mt-0.5">Create a custom system prompt.</p>
            </div>
          </div>
          <ChevronRight size={24} className="text-content-medium" />
        </button>
      )}

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-6">
        <span className="w-full h-px bg-surface-base-extraLight"></span>
        <span className="text-content-medium text-sm">Or</span>
        <span className="w-full h-px bg-surface-base-extraLight"></span>
      </div>

      <div className="border-b border-bdr-extraLight pb-1">
        <RadioGroup
        disabled={disabled}
        value={selectedId}
        onValueChange={setSelectedId}
        className="space-y-4 max-h-100 overflow-y-auto px-2.5 -mx-2.5"
      >
        {/* Presets */}
        {presetTemplates.length > 0 && (
          <div className="space-y-3">
            <h6 className="text-sm font-medium text-content-soft">
              Choose from presets
            </h6>

              {presetTemplates.map((template) => {
                const Icon = template.icon ? ICON_MAP[template.icon] : null;

                return (
                  <RadioGroupItem
                    key={template.id}
                    value={template.id}
                    id={template.id}
                    className="grid grid-cols-[1fr_20px] items-center gap-5 w-full rounded-2xl border border-bdr-extraLight hover:border-surface-base-brand-default p-4 cursor-pointer transition-colors duration-200 data-[state=checked]:border-surface-base-brand-default relative after:content-[''] after:absolute after:right-4 after:top-1/2 after:-translate-y-1/2 after:size-5 after:rounded-full after:border-5 after:border-transparency-dark-mode-24 after:shadow-[0_1.364px_2.727px_rgba(10,13,20,0.03)] data-[state=checked]:after:border-surface-base-brand-strong"
                  >
                    <div className="flex items-center gap-3 text-left">
                      <span className="text-content-default size-11 flex items-center justify-center rounded-full border border-bdr-light bg-surface-elevation-light shrink-0">
                        {Icon && <Icon size={20} />}
                      </span>
                      <div>
                        <h6 className="text-content-strong font-semibold -tracking-[0.096px] leading-[1.2]">
                          {template.name}
                        </h6>
                        {template.description && (
                          <p className="text-sm text-content-default font-normal mt-0.5">
                            {template.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </RadioGroupItem>
                )
              } 
              )}
          </div>
        )}

        {/* Custom */}
        {customTemplates.length > 0 && (
          <div className="space-y-3">
            <h6 className="text-sm font-medium text-content-soft">
              Custom
            </h6>

            {customTemplates.map((template) => (
              <RadioGroupItem
                key={template.id}
                value={template.id}
                id={template.id}
                className="grid grid-cols-[1fr_20px] items-center gap-5 w-full rounded-2xl border border-bdr-extraLight hover:border-surface-base-brand-default p-4 cursor-pointer transition-colors duration-200 data-[state=checked]:border-surface-base-brand-default relative after:content-[''] after:absolute after:right-4 after:top-1/2 after:-translate-y-1/2 after:size-5 after:rounded-full after:border-5 after:border-transparency-dark-mode-24 after:shadow-[0_1.364px_2.727px_rgba(10,13,20,0.03)] data-[state=checked]:after:border-surface-base-brand-strong"
              >
                <div className="flex items-center gap-3 text-left">
                  <span className="text-content-default size-11 flex items-center justify-center rounded-full border border-bdr-light bg-surface-elevation-light shrink-0">
                    <Settings size={20} />
                  </span>
                  <div>
                    <h6 className="text-content-strong font-semibold -tracking-[0.096px] leading-[1.2]">
                      {template.name}
                    </h6>
                    {template.prompt && (
                      <p className="text-sm text-content-default font-normal mt-0.5">
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
          disabled={!selectedId || disabled}
          onClick={handleSave}
          variant="gradient"
          className="text-sm"
        >
          Save Prompt
        </Button>
      </div>
    </div>
  );
}
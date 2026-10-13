"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { $http } from "@/lib/http";
import AlertError from "./ui/toast/AlertError";
import AlertSuccess from "./ui/toast/AlertSuccess";

type SystemPromptEditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
};

export function SystemPromptEditor({
  open,
  onOpenChange,
  onSave,
}: SystemPromptEditorProps) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !prompt.trim()) {
      toast.custom((id) => (
        <AlertError id={id} title="Please fill in all fields" />
      ));
      return;
    }

    setLoading(true);
    try {
      const response = await $http.post("/api/prompts", {
        name: name.trim(),
        prompt: prompt.trim(),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save prompt");
      }

      toast.custom((id) => (
        <AlertSuccess id={id} title="Custom prompt saved successfully" />
      ));
      setName("");
      setPrompt("");
      onOpenChange(false);
      onSave();
    } catch (error) {
      console.error("Error saving prompt:", error);
      toast.custom((id) => (
        <AlertError
          id={id}
          title={
            error instanceof Error ? error.message : "Failed to save prompt"
          }
        />
      ));
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setName("");
    setPrompt("");
    onOpenChange(false);
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-xl sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle asChild>
            <h4 className="-tracking-[0.2px] font-semibold text-content-strong text-xl leading-[1.2]">
              Create Custom Prompt
            </h4>
          </DialogTitle>
          <DialogDescription className="-tracking-[0.16px] mt-1 text-base text-content-default">
            Create a custom system prompt for personalized AI behavior.
          </DialogDescription>
        </DialogHeader>
        <div className="my-6 h-px w-full bg-bdr-light" />
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label className="font-medium" htmlFor="name">
              Name
            </Label>
            <Input
              disabled={loading}
              id="name"
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Python Expert, Marketing Assistant"
              value={name}
            />
          </div>

          <div className="grid gap-2">
            <Label className="font-medium" htmlFor="prompt">
              System Prompt
            </Label>
            <Textarea
              className="resize-none rounded-[10px] border-bdr-light bg-surface-base-subtle focus:bg-surface-base-faint"
              disabled={loading}
              id="prompt"
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="You are a..."
              rows={10}
              value={prompt}
            />
            <p className="text-[15px] text-content-light">
              This prompt will define the AI's personality and behavior for this
              chat.
            </p>
          </div>
        </div>
        <div className="my-6 h-px w-full bg-bdr-light" />
        <div className="flex justify-end gap-2">
          <Button disabled={loading} onClick={handleCancel} variant="outline">
            Cancel
          </Button>
          <Button
            className="text-sm"
            disabled={loading}
            onClick={handleSave}
            variant="gradient"
          >
            {loading ? "Saving..." : "Save Prompt"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

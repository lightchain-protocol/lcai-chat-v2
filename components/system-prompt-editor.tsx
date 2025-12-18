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
        <AlertError id={id} title='Please fill in all fields' />
        ));
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/prompts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: name.trim(), prompt: prompt.trim() }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save prompt");
      }

      toast.custom((id) => (
      <AlertSuccess id={id} title='Custom prompt saved successfully' />
      ));
      setName("");
      setPrompt("");
      onOpenChange(false);
      onSave();
    } catch (error) {
      console.error("Error saving prompt:", error);
      toast.custom((id) => (
        <AlertError id={id} title={error instanceof Error ? error.message : "Failed to save prompt"} />
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
            <h4 className="text-xl font-semibold text-content-strong -tracking-[0.2px] leading-[1.2]">Create Custom Prompt</h4>
          </DialogTitle>
          <DialogDescription className="text-content-default -tracking-[0.16px] text-base mt-1">
            Create a custom system prompt for personalized AI behavior.
          </DialogDescription>
        </DialogHeader>
        <div className="w-full h-px bg-bdr-light my-6"></div>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name" className="font-medium">Name</Label>
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
            <Label htmlFor="prompt" className="font-medium">System Prompt</Label>
            <Textarea
              className="resize-none rounded-[10px] border-bdr-light bg-surface-base-subtle focus:bg-surface-base-faint"
              disabled={loading}
              id="prompt"
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="You are a..."
              rows={10}
              value={prompt}
            />
            <p className="text-content-light text-[15px]">
              This prompt will define the AI's personality and behavior for this
              chat.
            </p>
          </div>
        </div>
        <div className="w-full h-px bg-bdr-light my-6"></div>
        <div className="flex justify-end gap-2">
          <Button disabled={loading} onClick={handleCancel} variant="outline">
            Cancel
          </Button>
          <Button disabled={loading} onClick={handleSave} variant="gradient" className="text-sm">
            {loading ? "Saving..." : "Save Prompt"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

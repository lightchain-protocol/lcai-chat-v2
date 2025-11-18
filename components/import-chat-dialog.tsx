"use client";

import type { DialogProps } from "@radix-ui/react-dialog";
import { Loader2Icon, UploadIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ImportChatDialog(props: DialogProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith(".json")) {
      toast.error("Please select a JSON file");
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size must be less than 10MB");
      return;
    }

    setIsUploading(true);

    try {
      // Read file content
      const fileContent = await file.text();
      const data = JSON.parse(fileContent);

      // Send to import API
      const response = await fetch("/api/chat/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to import chat");
      }

      const result = await response.json();

      toast.success("Chat imported successfully!");

      // Close dialog
      props.onOpenChange?.(false);

      // Navigate to the imported chat
      router.push(`/chat/${result.chatId}`);
      router.refresh();
    } catch (error) {
      console.error("Import error:", error);
      if (error instanceof SyntaxError) {
        toast.error("Invalid JSON file format");
      } else {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to import chat. Please check the file format."
        );
      }
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <Dialog {...props}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Chat</DialogTitle>
          <DialogDescription>
            Upload a previously exported chat JSON file to import it into your
            account.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col items-center gap-4 rounded-lg border-2 border-muted-foreground/25 border-dashed p-8">
            <UploadIcon className="size-12 text-muted-foreground" />
            <div className="text-center">
              <p className="mb-1 font-medium text-sm">
                Click to upload or drag and drop
              </p>
              <p className="text-muted-foreground text-xs">
                JSON files only (max 10MB)
              </p>
            </div>
            <Button
              disabled={isUploading}
              onClick={handleUploadClick}
              variant="outline"
            >
              {isUploading ? (
                <>
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <UploadIcon className="mr-2 size-4" />
                  Select File
                </>
              )}
            </Button>
          </div>

          <input
            accept=".json"
            className="hidden"
            disabled={isUploading}
            onChange={handleFileSelect}
            ref={fileInputRef}
            type="file"
          />

          <div className="rounded-lg bg-muted p-3">
            <p className="font-medium text-xs">Note:</p>
            <ul className="mt-1 list-inside list-disc space-y-1 text-muted-foreground text-xs">
              <li>Imported chats will be marked as private</li>
              <li>A new chat ID will be assigned</li>
              <li>The chat title will include "(Imported)"</li>
            </ul>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button
            disabled={isUploading}
            onClick={() => props.onOpenChange?.(false)}
            variant="outline"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

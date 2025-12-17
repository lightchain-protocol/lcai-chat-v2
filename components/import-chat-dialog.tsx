"use client";

import type { DialogProps } from "@radix-ui/react-dialog";
import { Info, Loader2Icon, UploadIcon } from "lucide-react";
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
import Image from "next/image";
import AlertError from "./ui/toast/AlertError";
import AlertSuccess from "./ui/toast/AlertSuccess";

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
      toast.custom((id) => (
        <AlertError id={id} title='Please select a JSON file' />
      ));
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.custom((id) => (
        <AlertError id={id} title='File size must be less than 10MB' />
      ));
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

      toast.custom((id) => (
      <AlertSuccess id={id} title='Chat imported successfully!' />
      ));

      // Close dialog
      props.onOpenChange?.(false);

      // Navigate to the imported chat
      router.push(`/chat/${result.chatId}`);
      router.refresh();
    } catch (error) {
      console.error("Import error:", error);
      if (error instanceof SyntaxError) {
        toast.custom((id) => (
        <AlertError id={id} title='Invalid JSON file format' />
        ));
      } else {
        toast.custom((id) => (
        <AlertError id={id} title={ error instanceof Error
            ? error.message
            : "Failed to import chat. Please check the file format."} />
        ));
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
      <DialogContent className="sm:max-w-xl rounded-lg sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle>Import Chat</DialogTitle>
          <DialogDescription>
            Upload a previously exported chat JSON file to import it into your
            account.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 mt-4">
          <div className="flex flex-col items-center gap-4 rounded-lg border-2 border-bdr-soft border-dashed p-8 bg-surface-base-subtle">
            <Image className="dark:hidden" src="/images/icons/upload-file-light.png" width={162} height={135} alt="Upload Icon"></Image>
            <Image className="hidden dark:block" src="/images/icons/upload-file-dark.png" width={162} height={135} alt="Upload Icon"></Image>
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
              className="rounded-[10px]"
            >
              {isUploading ? (
                <>
                  <Loader2Icon className="size-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <UploadIcon className="size-4" />
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

          <div className="bg-surface-base-light p-3 rounded-xl border border-bdr-soft">
            <h6 className="font-medium text-base flex items-center gap-1.5 text-content-strong"><Info size={16} /> Note:</h6>
            <ul className="mt-1 list-inside list-disc space-y-1 text-content-medium text-sm">
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

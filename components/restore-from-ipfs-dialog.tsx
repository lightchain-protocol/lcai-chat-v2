"use client";

import type { DialogProps } from "@radix-ui/react-dialog";
import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RestoreFromIPFSDialog(props: DialogProps) {
  const [cid, setCid] = useState("");
  const [isRestoring, setIsRestoring] = useState(false);
  const router = useRouter();

  const handleRestore = async () => {
    if (!cid.trim()) {
      toast.error("Please enter a valid CID");
      return;
    }

    setIsRestoring(true);
    try {
      const response = await fetch("/api/chat/restore", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cid: cid.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to restore chat");
      }

      toast.success("Chat restored successfully!");
      props.onOpenChange?.(false);
      setCid("");
      router.push(`/chat/${data.chatId}`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to restore chat"
      );
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <Dialog {...props}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Restore Chat from IPFS</DialogTitle>
          <DialogDescription>
            Enter the IPFS CID (Content Identifier) to restore a chat backup.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="cid">IPFS CID</Label>
            <Input
              disabled={isRestoring}
              id="cid"
              onChange={(e) => setCid(e.target.value)}
              placeholder="QmXxxx... or bafybei..."
              value={cid}
            />
          </div>
          <div className="rounded-lg bg-muted p-3">
            <p className="font-medium text-xs">Note:</p>
            <ul className="mt-1 list-inside list-disc space-y-1 text-muted-foreground text-xs">
              <li>Restored chats will be marked as private</li>
              <li>A new chat ID will be assigned</li>
              <li>The chat title will include "(Restored from IPFS)"</li>
              <li>If the chat was encrypted, you must use the same wallet</li>
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={isRestoring}
            onClick={() => props.onOpenChange?.(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={isRestoring} onClick={handleRestore} type="button">
            {isRestoring ? (
              <>
                <Loader2Icon className="mr-2 size-4 animate-spin" />
                Restoring...
              </>
            ) : (
              "Restore"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

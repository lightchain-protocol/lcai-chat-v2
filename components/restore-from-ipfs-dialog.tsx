"use client";

import type { DialogProps } from "@radix-ui/react-dialog";
import { Info, Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
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
import AlertError from "./ui/toast/AlertError";
import AlertSuccess from "./ui/toast/AlertSuccess";

export function RestoreFromIPFSDialog(props: DialogProps) {
  const [cid, setCid] = useState("");
  const [isRestoring, setIsRestoring] = useState(false);
  const router = useRouter();

  const handleRestore = async () => {
    if (!cid.trim()) {
      toast.custom((id) => (
        <AlertError id={id} title="Please enter a valid CID" />
      ));
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

      toast.custom((id) => (
      <AlertSuccess id={id} title='Chat restored successfully!' />
      ));
      props.onOpenChange?.(false);
      setCid("");
      router.push(`/chat/${data.chatId}`);
      router.refresh();
    } catch (error) {
      toast.custom((id) => (
        <AlertError id={id} title={error instanceof Error ? error.message : "Failed to restore chat"} />
        ));
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <Dialog {...props}>
      <DialogContent className="sm:max-w-lg rounded-lg sm:rounded-3xl">
        <DialogHeader>
          <DialogTitle>Restore Chat from IPFS</DialogTitle>
          <DialogDescription>
            Enter the IPFS CID (Content Identifier) to restore a chat backup.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label htmlFor="cid" className="font-medium">IPFS CID</Label>
            <Input
              disabled={isRestoring}
              id="cid"
              onChange={(e) => setCid(e.target.value)}
              placeholder="QmXxxx... or bafybei..."
              value={cid}
            />
          </div>
          <div className="bg-surface-base-light p-3 rounded-xl border border-bdr-soft">
            <h6 className="font-medium text-base flex items-center gap-1.5 text-content-strong"><Info size={16} /> Note:</h6>
            <ul className="mt-1 list-inside list-disc space-y-1 text-content-medium text-sm">
              <li>Restored chats will be marked as private</li>
              <li>A new chat ID will be assigned</li>
              <li>The chat title will include "(Restored from IPFS)"</li>
              <li>If the chat was encrypted, you must use the same wallet</li>
            </ul>
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-6">
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
                <Loader2Icon className="size-4 animate-spin" />
                Restoring...
              </>
            ) : (
              "Restore"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

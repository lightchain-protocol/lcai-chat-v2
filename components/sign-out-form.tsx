"use client";
import { useDisconnect } from "@reown/appkit/react";
import Form from "next/form";
import { signOut } from "next-auth/react";

export const SignOutForm = () => {
  const { disconnect } = useDisconnect();
  return (
    <Form
      action={async () => {
        "use server";
        await disconnect();
        await signOut();
      }}
      className="w-full"
    >
      <button
        className="w-full px-1 py-0.5 text-left text-red-500"
        type="submit"
      >
        Sign out
      </button>
    </Form>
  );
};

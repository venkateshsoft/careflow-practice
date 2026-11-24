
"use client";

import { useFormStatus } from "react-dom";

type Props = {
  label: string;
  pendingLabel?: string;
  className?: string;
  variant?: "primary" | "secondary" | "danger";
};

export default function DiagnosisSubmitButton({
  label,
  pendingLabel = "Processing...",
  className = "",
  variant = "secondary",
}: Props) {
  const { pending } = useFormStatus();

  const styles = {
    primary: "text-teal",
    secondary: "text-teal",
    danger: "text-red-600",
  };

  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className={`${styles[variant]} ${className} ${
        pending ? "cursor-not-allowed opacity-50" : ""
      }`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
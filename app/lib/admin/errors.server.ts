import { BookingError } from "../bookings/validation";
import { data } from "react-router";
import { z } from "zod";
import { CatalogError } from "./catalog.server";
export function formError(error: unknown) {
  if (error instanceof Response) throw error;
  if (error instanceof z.ZodError) return data({ error: "Please check the highlighted fields.", fields: error.flatten().fieldErrors }, { status: 400 });
  if (error instanceof BookingError) return data({ error: error.message, fields: {} as Record<string, string[] | undefined> }, { status: error.status });
  if (error instanceof CatalogError) return data({ error: error.message, fields: {} as Record<string, string[] | undefined> }, { status: 400 });
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "P2002") return data({ error: "That value is already in use. Choose a different one.", fields: {} as Record<string, string[] | undefined> }, { status: 409 });
  if (code === "P2025") throw new Response("Record not found.", { status: 404 });
  throw error;
}

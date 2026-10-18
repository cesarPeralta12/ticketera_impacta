import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EventView } from "@/components/event-view";
import { getPublishedEvent } from "@/lib/events";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await getPublishedEvent((await params).slug);
  return event ? { title: event.title, description: event.description ?? undefined } : {};
}

export default async function EventPage({ params }: Props) {
  await connection();
  const event = await getPublishedEvent((await params).slug);
  if (!event) notFound();
  return <EventView event={event} />;
}

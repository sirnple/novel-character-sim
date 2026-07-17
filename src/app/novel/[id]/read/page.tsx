import { redirect } from "next/navigation";

/** Reading page removed — keep route as redirect for old bookmarks. */
export default function ReadPageRedirect({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/novel/${params.id}/write`);
}

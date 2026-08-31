import { authenticate } from "../shopify.server";
import db from "../db.server";

const clean = (value) => String(value || "").trim() || null;

export const action = async ({ request }) => {
  if (request.method !== "POST") return Response.json({ ok:false, error:"Method not allowed." }, { status:405 });
  try {
    const { session } = await authenticate.admin(request);
    const data = await request.formData();
    const intent = String(data.get("intent") || "");
    const payload = {
      name: String(data.get("name") || "").trim(),
      legalName: clean(data.get("legalName")),
      email: clean(data.get("email")),
      spotifyUrl: clean(data.get("spotifyUrl")),
      appleMusicUrl: clean(data.get("appleMusicUrl")),
      websiteUrl: clean(data.get("websiteUrl")),
      notes: clean(data.get("notes")),
    };
    if (!payload.name) return Response.json({ ok:false, error:"Artist name is required." }, { status:400 });

    if (intent === "create") {
      const artist = await db.artist.create({ data: { shop:session.shop, ...payload } });
      return Response.json({ ok:true, artistId:artist.id, message:`${artist.name} added to the artist directory.` });
    }
    if (intent === "update") {
      const artistId = String(data.get("artistId") || "");
      const owned = await db.artist.findFirst({ where:{ id:artistId, shop:session.shop } });
      if (!owned) return Response.json({ ok:false, error:"Artist not found." }, { status:404 });
      const artist = await db.artist.update({ where:{id:owned.id}, data:payload });

      // Refresh the legacy release display cache anywhere this artist is the first primary release artist.
      const assignments = await db.releaseArtist.findMany({ where:{artistId:artist.id}, select:{releaseId:true} });
      for (const assignment of assignments) {
        const releaseArtists = await db.releaseArtist.findMany({ where:{releaseId:assignment.releaseId}, include:{artist:true}, orderBy:{position:"asc"} });
        const first = releaseArtists.find((item)=>item.role==="PRIMARY") || releaseArtists[0];
        await db.release.update({ where:{id:assignment.releaseId}, data:{artistName:first?.artist?.name || null} });
      }
      return Response.json({ ok:true, message:`${artist.name} updated.` });
    }
    return Response.json({ ok:false, error:"Unknown artist action." }, { status:400 });
  } catch (error) {
    console.error("ReleaseCore: artist mutation failed", error);
    return Response.json({ ok:false, error:error instanceof Error ? `ReleaseCore could not save this artist: ${error.message}` : "ReleaseCore could not save this artist." }, { status:500 });
  }
};

import { NextResponse } from "next/server";
import { isUuid } from "@/lib/ids";
import { DomainError } from "@/lib/services/p2p/shared";
import { errorToResponse, getActor, readJson } from "./helpers";

type Role = "REQUESTER" | "MANAGER" | "FINANCE" | "ADMIN";
type Params = { params: Promise<{ id: string }> };

/** One master data resource as the generic routes see it. Reads are open to
 *  every authenticated role; create and edit take `editRoles`; archive is
 *  ADMIN only. */
export interface MasterDataResource<Row, Input> {
  /** JSON key of the list response, e.g. "suppliers". */
  listKey: string;
  label: string;
  editRoles: readonly Role[];
  list(opts: { includeArchived: boolean }): Promise<Row[]>;
  get(id: string): Promise<Row>;
  parseCreate(body: unknown): Input;
  parsePatch(body: unknown): Partial<Input>;
  create(input: Input, actorUserId: string): Promise<Row>;
  update(id: string, patch: Partial<Input>, actorUserId: string): Promise<Row>;
  archive(id: string, actorUserId: string): Promise<Row>;
}

export async function requireRole(request: Request, roles: readonly Role[]) {
  const actor = await getActor(request);
  if (!roles.includes(actor.role)) {
    throw new DomainError("FORBIDDEN", `Requires ${roles.join(" or ")} role`);
  }
  return actor;
}

async function idFrom(params: Params["params"], label: string): Promise<string> {
  const { id } = await params;
  if (!isUuid(id)) throw new DomainError("NOT_FOUND", `${label} not found`);
  return id;
}

export function collectionRoutes<Row, Input>(r: MasterDataResource<Row, Input>) {
  return {
    async GET(request: Request) {
      try {
        await getActor(request);
        const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
        return NextResponse.json({ [r.listKey]: await r.list({ includeArchived }) });
      } catch (error) {
        return errorToResponse(error);
      }
    },
    async POST(request: Request) {
      try {
        const actor = await requireRole(request, r.editRoles);
        const input = r.parseCreate(await readJson(request));
        return NextResponse.json(await r.create(input, actor.id), { status: 201 });
      } catch (error) {
        return errorToResponse(error);
      }
    },
  };
}

export function itemRoutes<Row, Input>(r: MasterDataResource<Row, Input>) {
  return {
    async GET(request: Request, { params }: Params) {
      try {
        await getActor(request);
        return NextResponse.json(await r.get(await idFrom(params, r.label)));
      } catch (error) {
        return errorToResponse(error);
      }
    },
    async PATCH(request: Request, { params }: Params) {
      try {
        const actor = await requireRole(request, r.editRoles);
        const id = await idFrom(params, r.label);
        const patch = r.parsePatch(await readJson(request));
        return NextResponse.json(await r.update(id, patch, actor.id));
      } catch (error) {
        return errorToResponse(error);
      }
    },
  };
}

export function archiveRoute<Row, Input>(r: MasterDataResource<Row, Input>) {
  return async function POST(request: Request, { params }: Params) {
    try {
      const actor = await requireRole(request, ["ADMIN"]);
      return NextResponse.json(await r.archive(await idFrom(params, r.label), actor.id));
    } catch (error) {
      return errorToResponse(error);
    }
  };
}

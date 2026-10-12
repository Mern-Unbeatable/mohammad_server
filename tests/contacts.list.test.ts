import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionStatus } from "@prisma/client";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    connection: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn(), count: vi.fn() },
    profile: { updateMany: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

vi.mock("@/infrastructure/prisma", () => ({ prisma: prismaMock }));

import { contactsService } from "@/modules/supplier/contacts/contacts.service";

type Profile = { firstName: string; lastName: string; company: string; title: string; country: string };
type User = { id: string; status: string; createdAt: Date; profile: Profile };
type Conn = {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: ConnectionStatus;
  createdAt: Date;
  requester: User;
  addressee: User;
};

type UserFilter = {
  profile?: Partial<Record<keyof Profile, string | { contains: string }>>;
  OR?: UserFilter[];
};

const matchesUser = (user: User, filter: UserFilter = {}): boolean => {
  const profileOk = Object.entries(filter.profile ?? {}).every(([key, cond]) => {
    const value = user.profile[key as keyof Profile];
    return typeof cond === "string"
      ? value === cond
      : value.toLowerCase().includes(cond.contains.toLowerCase());
  });
  return profileOk && (!filter.OR || filter.OR.some((f) => matchesUser(user, f)));
};

type ConnWhere = {
  status: ConnectionStatus;
  OR: { addresseeId?: string; requesterId?: string; requester?: UserFilter; addressee?: UserFilter }[];
};

const matchesConn = (c: Conn, where: ConnWhere) =>
  c.status === where.status &&
  where.OR.some(
    (b) =>
      (b.addresseeId === undefined || b.addresseeId === c.addresseeId) &&
      (b.requesterId === undefined || b.requesterId === c.requesterId) &&
      matchesUser(c.requester, b.requester) &&
      matchesUser(c.addressee, b.addressee),
  );

type OrderBy = Record<string, "asc" | "desc">[];
const sortBy = <T extends { id: string; createdAt: Date }>(rows: T[], orderBy: OrderBy) =>
  [...rows].sort((a, b) => {
    for (const rule of orderBy) {
      const [key, dir] = Object.entries(rule)[0];
      const av = key === "createdAt" ? a.createdAt.getTime() : a.id;
      const bv = key === "createdAt" ? b.createdAt.getTime() : b.id;
      if (av !== bv) return (av < bv ? -1 : 1) * (dir === "asc" ? 1 : -1);
    }
    return 0;
  });

const SAME_TIME = new Date("2026-10-01T10:00:00Z");
const ME = "me";
const user = (id: string, country = "France", firstName = id): User => ({
  id,
  status: "ACTIVE",
  createdAt: SAME_TIME,
  profile: { firstName, lastName: "Member", company: "Lab", title: "Analyst", country },
});
const me = user(ME, "France", "Zelda");

let connections: Conn[] = [];
const connect = (other: User, { incoming = false, status = ConnectionStatus.ACCEPTED } = {}) => {
  const requester = incoming ? other : me;
  const addressee = incoming ? me : other;
  connections.push({
    id: `conn-${String(connections.length).padStart(3, "0")}`,
    requesterId: requester.id,
    addresseeId: addressee.id,
    status,
    // Every row shares a timestamp, so only the id tiebreaker orders them.
    createdAt: SAME_TIME,
    requester,
    addressee,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  connections = [];
  prismaMock.connection.findMany.mockImplementation(
    async ({ where, orderBy, skip, take }: { where: ConnWhere; orderBy: OrderBy; skip: number; take: number }) =>
      where.status
        ? sortBy(connections.filter((c) => matchesConn(c, where)), orderBy).slice(skip, skip + take)
        : // Directory status lookup for the listed page.
          connections.filter((c) => c.requesterId === ME || c.addresseeId === ME),
  );
  prismaMock.connection.findUnique.mockImplementation(
    async ({ where }: { where: { id: string } }) => connections.find((c) => c.id === where.id) ?? null,
  );
  prismaMock.connection.update.mockImplementation(
    async ({ where, data }: { where: { id: string }; data: { status: ConnectionStatus } }) => {
      const row = connections.find((c) => c.id === where.id)!;
      row.status = data.status;
      return row;
    },
  );
  prismaMock.profile.updateMany.mockResolvedValue({ count: 2 });
  prismaMock.notification.create.mockResolvedValue({});
  prismaMock.connection.count.mockImplementation(
    async ({ where }: { where: ConnWhere }) => connections.filter((c) => matchesConn(c, where)).length,
  );
});

const listAll = async (query: Record<string, unknown>) => {
  const ids: string[] = [];
  let meta = { totalPages: 1, total: 0 };
  for (let page = 1; page <= meta.totalPages; page++) {
    const result = await contactsService.listContacts(ME, {
      page,
      pageSize: 8,
      sort: "desc",
      ...query,
    } as never);
    meta = result.meta;
    ids.push(...result.data.map((c) => c.id));
  }
  return { ids, meta };
};

describe("contactsService.listContacts connected filter", () => {
  it("returns every connection exactly once across pages, in both directions", async () => {
    for (let i = 0; i < 19; i++) connect(user(`u${i}`), { incoming: i % 2 === 0 });
    connect(user("pending-1"), { status: ConnectionStatus.PENDING });

    const { ids, meta } = await listAll({ status: "accepted" });

    expect(meta).toMatchObject({ total: 19, totalPages: 3 });
    expect(ids).toHaveLength(19);
    expect(new Set(ids)).toEqual(new Set(Array.from({ length: 19 }, (_, i) => `u${i}`)));
  });

  it("orders by createdAt with an id tiebreaker", async () => {
    await contactsService.listContacts(ME, { page: 1, pageSize: 8, sort: "desc", status: "accepted" } as never);
    expect(prismaMock.connection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    );
  });

  it("applies country and search to the other member, with totals for the filtered set", async () => {
    for (let i = 0; i < 10; i++) connect(user(`fr${i}`, "France"), { incoming: i % 2 === 0 });
    for (let i = 0; i < 5; i++) connect(user(`de${i}`, "Germany"));
    connect(user("anna", "Germany", "Anna"), { incoming: true });

    const germany = await listAll({ status: "accepted", country: "Germany" });
    expect(germany.meta).toMatchObject({ total: 6, totalPages: 1 });
    expect(germany.ids.sort()).toEqual(["anna", "de0", "de1", "de2", "de3", "de4"]);

    const anna = await listAll({ status: "accepted", search: "ann" });
    expect(anna.ids).toEqual(["anna"]);

    // The caller's own profile must not match the search.
    const myName = await listAll({ status: "accepted", search: "zelda" });
    expect(myName.ids).toEqual([]);

    const france = await listAll({ status: "accepted", country: "France" });
    expect(france.meta).toMatchObject({ total: 10, totalPages: 2 });
    expect(new Set(france.ids).size).toBe(10);
  });

  it("keeps incoming and outgoing requests separate", async () => {
    connect(user("in-1"), { incoming: true, status: ConnectionStatus.PENDING });
    connect(user("in-2"), { incoming: true, status: ConnectionStatus.PENDING });
    connect(user("out-1"), { status: ConnectionStatus.PENDING });

    const incoming = await listAll({ status: "pending", direction: "incoming" });
    expect(incoming.ids.sort()).toEqual(["in-1", "in-2"]);
    const outgoing = await listAll({ status: "pending", direction: "outgoing" });
    expect(outgoing.ids).toEqual(["out-1"]);
  });
});

describe("contactsService.listContacts directory", () => {
  it("orders members by createdAt with an id tiebreaker and keeps filters", async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.connection.findMany.mockResolvedValue([]);

    await contactsService.listContacts(ME, {
      page: 2,
      pageSize: 8,
      sort: "desc",
      country: "France",
      search: "anna",
    } as never);

    const args = prismaMock.user.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(args.skip).toBe(8);
    expect(args.where).toMatchObject({
      id: { not: ME },
      status: "ACTIVE",
      sentConnections: { none: { addresseeId: ME, status: ConnectionStatus.ACCEPTED } },
      receivedConnections: { none: { requesterId: ME, status: ConnectionStatus.ACCEPTED } },
      profile: { country: "France" },
    });
    expect(args.where.OR).toHaveLength(4);
  });
});

describe("contactsService.listContacts directory excludes connected members", () => {
  type DirectoryWhere = {
    id: { not: string };
    status: string;
    sentConnections: { none: { addresseeId: string; status: ConnectionStatus } };
    receivedConnections: { none: { requesterId: string; status: ConnectionStatus } };
  } & UserFilter;

  let members: User[] = [];

  const matchesDirectory = (u: User, where: DirectoryWhere) => {
    const sent = where.sentConnections.none;
    const received = where.receivedConnections.none;
    return (
      u.id !== where.id.not &&
      u.status === where.status &&
      !connections.some(
        (c) => c.requesterId === u.id && c.addresseeId === sent.addresseeId && c.status === sent.status,
      ) &&
      !connections.some(
        (c) => c.addresseeId === u.id && c.requesterId === received.requesterId && c.status === received.status,
      ) &&
      matchesUser(u, where)
    );
  };

  beforeEach(() => {
    members = [me];
    prismaMock.user.findMany.mockImplementation(
      async ({ where, orderBy, skip, take }: { where: DirectoryWhere; orderBy: OrderBy; skip: number; take: number }) =>
        sortBy(members.filter((u) => matchesDirectory(u, where)), orderBy).slice(skip, skip + take),
    );
    prismaMock.user.count.mockImplementation(
      async ({ where }: { where: DirectoryWhere }) => members.filter((u) => matchesDirectory(u, where)).length,
    );
  });

  const member = (id: string, country?: string, firstName?: string) => {
    const u = user(id, country, firstName);
    members.push(u);
    return u;
  };

  it("hides accepted connections in either direction and never lists the caller", async () => {
    connect(member("accepted-out"));
    connect(member("accepted-in"), { incoming: true });
    for (let i = 0; i < 10; i++) member(`free-${i}`);

    const { ids, meta } = await listAll({});

    expect(meta).toMatchObject({ total: 10, totalPages: 2 });
    expect(ids).toHaveLength(10);
    expect(new Set(ids)).toEqual(new Set(Array.from({ length: 10 }, (_, i) => `free-${i}`)));
    expect(ids).not.toContain(ME);
  });

  it("keeps pending and declined members, annotated with their status", async () => {
    connect(member("sent"), { status: ConnectionStatus.PENDING });
    connect(member("received"), { incoming: true, status: ConnectionStatus.PENDING });
    connect(member("declined"), { incoming: true, status: ConnectionStatus.DECLINED });
    connect(member("friend"));

    const result = await contactsService.listContacts(ME, { page: 1, pageSize: 8, sort: "desc" } as never);
    const byId = Object.fromEntries(result.data.map((c) => [c.id, c]));

    expect(Object.keys(byId).sort()).toEqual(["declined", "received", "sent"]);
    expect(byId.sent).toMatchObject({ connectionStatus: "PENDING", connectionDirection: "outgoing" });
    expect(byId.received).toMatchObject({ connectionStatus: "PENDING", connectionDirection: "incoming" });
    expect(byId.declined).toMatchObject({ connectionStatus: "DECLINED" });
    expect(result.meta.total).toBe(3);
  });

  it("does not hide members connected to someone else", async () => {
    const other = member("other-user");
    const theirFriend = member("their-friend");
    connections.push({
      id: "conn-x",
      requesterId: other.id,
      addresseeId: theirFriend.id,
      status: ConnectionStatus.ACCEPTED,
      createdAt: SAME_TIME,
      requester: other,
      addressee: theirFriend,
    });

    const { ids } = await listAll({});
    expect(ids.sort()).toEqual(["other-user", "their-friend"]);
  });

  it("combines the exclusion with search and country before paging", async () => {
    for (let i = 0; i < 9; i++) member(`fr-${i}`, "France");
    connect(member("fr-friend", "France"));
    connect(member("de-friend", "Germany"), { incoming: true });
    member("de-anna", "Germany", "Anna");

    const france = await listAll({ country: "France" });
    expect(france.meta).toMatchObject({ total: 9, totalPages: 2 });
    expect(france.ids).not.toContain("fr-friend");
    expect(new Set(france.ids).size).toBe(9);

    const germany = await listAll({ country: "Germany" });
    expect(germany.ids).toEqual(["de-anna"]);
  });

  it("moves a member from People to Connected when their request is confirmed", async () => {
    for (let i = 0; i < 8; i++) member(`free-${i}`);
    connect(member("anna", "Germany", "Anna"), { incoming: true, status: ConnectionStatus.PENDING });
    const request = connections.at(-1)!;

    const before = await listAll({});
    expect(before.meta).toMatchObject({ total: 9, totalPages: 2 });
    expect(before.ids).toContain("anna");
    expect((await listAll({ status: "pending", direction: "incoming" })).ids).toEqual(["anna"]);
    expect((await listAll({ status: "accepted" })).ids).toEqual([]);

    await contactsService.respondToConnection(ME, request.id, true);

    const after = await listAll({});
    expect(after.meta).toMatchObject({ total: 8, totalPages: 1 });
    expect(after.ids).not.toContain("anna");
    expect(new Set(after.ids).size).toBe(8);
    expect((await listAll({ status: "pending", direction: "incoming" })).ids).toEqual([]);
    expect((await listAll({ status: "accepted" })).ids).toEqual(["anna"]);
  });

  it("keeps a declined request in People and out of Connected", async () => {
    connect(member("bob"), { incoming: true, status: ConnectionStatus.PENDING });
    await contactsService.respondToConnection(ME, connections.at(-1)!.id, false);

    expect((await listAll({})).ids).toEqual(["bob"]);
    expect((await listAll({ status: "accepted" })).ids).toEqual([]);
  });
});

import { NextRequest, NextResponse } from "next/server";

import prisma from "@/prisma/db";

export async function POST() {
  // console.log("Deleting existing entries in Contact table...");
  const deleteContacts = await prisma.contact.deleteMany({});

  // console.log("Contact table reset. Delete count shown below.");
  // console.log(deleteContacts);

  return NextResponse.json(
    {
      message: `Contacts reset. ${deleteContacts.count} ${
        deleteContacts.count === 1 ? "contact" : "contacts"
      } deleted.`,
    },
    { status: 200 }
  );
}

export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/", request.url));
}

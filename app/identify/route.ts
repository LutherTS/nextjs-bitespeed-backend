import { NextRequest, NextResponse } from "next/server";

import { z } from "zod";
import isEmail from "validator/lib/isEmail";
import prisma from "@/prisma/db";

const IdentifySchema = z.object({
  phoneNumber: z
    .string({
      invalid_type_error: "Please provide a string for the phone number.",
    })
    .regex(/^\+?[0-9]*$/gm, {
      message:
        "Please enter only numbers for the phone number. (You can start with a '+' though.)",
    })
    .max(15, {
      message: "Your phone number cannot be more than 15 characters.",
    }),
  email: z
    .string({
      invalid_type_error: "Please provide a string for the email.",
    })
    .max(50, {
      message: "Your email cannot be more than 50 characters.",
    }),
});

export async function POST(request: NextRequest) {
  const data = await request.json();
  let phoneNumberData = data.phoneNumber || "";
  let emailData = data.email || "";

  const validatedFields = IdentifySchema.safeParse({
    phoneNumber: phoneNumberData,
    email: emailData,
  });

  if (!validatedFields.success) {
    return NextResponse.json(
      {
        errors: validatedFields.error.flatten().fieldErrors,
        message: "The data was not properly provided.",
      },
      { status: 400 }
    );
  }

  const { phoneNumber, email } = validatedFields.data;

  if (email !== "" && !isEmail(email))
    return NextResponse.json(
      {
        message: "Error: Please adhere to a valid format for the email.",
      },
      { status: 400 }
    );

  let primaryContactId;
  let emails;
  let phoneNumbers;
  let secondaryContactIds;

  const exactContact = await prisma.contact.findFirst({
    where: { AND: [{ phoneNumber }, { email }] },
  });

  if (exactContact) {
    // console.log("Exact contact already exists.");
    primaryContactId =
      exactContact.linkPrecedence === "primary"
        ? exactContact.id
        : exactContact.linkedId;
  } else {
    const contactByPhoneNumber = await prisma.contact.findFirst({
      where: { phoneNumber },
    });
    const contactByEmail = await prisma.contact.findFirst({
      where: { email },
    });

    if (!contactByPhoneNumber && !contactByEmail) {
      if (phoneNumber === "" || email === "") {
        // console.log(
        //   "Error: Cannot create a brand-new contact without both a phone number and an email."
        // );
        return NextResponse.json(
          {
            message:
              "Error: Cannot create a brand-new contact without both a phone number and an email.",
          },
          { status: 400 }
        );
      } else {
        // console.log(
        //   "Creating a brand-new contact from new phone number and new email."
        // );
        const newContact = await prisma.contact.create({
          data: {
            phoneNumber,
            email,
            linkPrecedence: "primary",
          },
        });
        primaryContactId = newContact.id;
      }
    }

    if (contactByPhoneNumber && !contactByEmail) {
      if (contactByPhoneNumber && email === "") {
        // console.log("Preexisting contact by phone number, no email provided.");
      } else {
        // console.log("Creating new secondary contact with new email.");
        await prisma.contact.create({
          data: {
            phoneNumber,
            email,
            linkPrecedence: "secondary",
            linkedId:
              contactByPhoneNumber.linkPrecedence === "primary"
                ? contactByPhoneNumber.id
                : contactByPhoneNumber.linkedId,
          },
        });
      }
      primaryContactId =
        contactByPhoneNumber.linkPrecedence === "primary"
          ? contactByPhoneNumber.id
          : contactByPhoneNumber.linkedId;
    }

    if (contactByEmail && !contactByPhoneNumber) {
      if (contactByEmail && phoneNumber === "") {
        // console.log("Preexisting contact by email, no phone number provided.");
      } else {
        // console.log("Creating new secondary contact with new phone number.");
        await prisma.contact.create({
          data: {
            phoneNumber,
            email,
            linkPrecedence: "secondary",
            linkedId:
              contactByEmail.linkPrecedence === "primary"
                ? contactByEmail.id
                : contactByEmail.linkedId,
          },
        });
      }
      primaryContactId =
        contactByEmail.linkPrecedence === "primary"
          ? contactByEmail.id
          : contactByEmail.linkedId;
    }

    // exactContact is already catched on top so the following are bound
    // to be different
    if (contactByEmail && contactByPhoneNumber) {
      const contacts = [contactByEmail, contactByPhoneNumber];
      const primaries = contacts.filter((e) => e.linkPrecedence === "primary");

      if (primaries.length === 2) {
        // console.log("Conflicting primaries.");
        contacts.sort(
          // @ts-ignore
          // It works. Typescript just doesn't understand this yet.
          (a, b) => a.createdAt - b.createdAt
        );

        await prisma.contact.update({
          where: { id: contacts[1].id },
          data: {
            linkPrecedence: "secondary",
            linkedId: contacts[0].id,
          },
        });
        // console.log("Latest primary turned into secondary.");

        await prisma.contact.updateMany({
          where: { linkedId: contacts[1].id },
          data: {
            linkPrecedence: "secondary",
            linkedId: contacts[0].id,
          },
        });
        // console.log(
        //   "Former primary secondaries reassigned to earliest primary."
        // );
        primaryContactId = contacts[0].id;
      }

      if (primaries.length === 1) {
        // console.log("No conflicting primaries.");
        const primary = primaries[0];

        // console.log(
        //   "However, the decision is made that in such instances, the primary of the secondary and all its secondaries (including the secondary provided) are reassigned to the primary provided, if it is the oldest, or inversely if it isn't."
        // );
        const secondary = contacts.find(
          (e) => e.linkPrecedence === "secondary"
        );

        // impossible but for type safety
        if (!secondary?.linkedId)
          return NextResponse.json(
            {
              message: "Error: Somehow no secondary was found.",
            },
            { status: 404 }
          );

        const primaryOfSecondary = await prisma.contact.findUnique({
          where: { id: secondary.linkedId },
        });

        // also for type safety just in case
        if (!primaryOfSecondary)
          return NextResponse.json(
            {
              message: "Error: Somehow no primary of secondary was found.",
            },
            { status: 404 }
          );

        const thesePrimaries = [primary, primaryOfSecondary];

        thesePrimaries.sort(
          // @ts-ignore
          // It works. Typescript just doesn't understand this yet.
          (a, b) => a.createdAt - b.createdAt
        );

        await prisma.contact.updateMany({
          where: {
            OR: [
              { id: thesePrimaries[1].id },
              { linkedId: thesePrimaries[1].id },
            ],
          },
          data: {
            linkedId: thesePrimaries[0].id,
            linkPrecedence: "secondary",
          },
        });

        primaryContactId = thesePrimaries[0].id;
      }

      if (primaries.length === 0) {
        // console.log(
        //   "Two secondaries found, once for phone number, one for email."
        // );
        // console.log(
        //   "Consequently, the decision is made that in such instances, only the earliest of their primaries will be shown. (Handling both cases when the primaries are common and uncommon.)"
        // ); // NOT ANYMORE

        // again impossible, but necessary for type safety
        if (!contactByPhoneNumber.linkedId || !contactByEmail.linkedId)
          return NextResponse.json(
            {
              message:
                "Error: Somehow no linkedId was found on at least one of the contacts.",
            },
            { status: 404 }
          );

        const theirPrimaries = await prisma.contact.findMany({
          where: {
            OR: [
              { id: contactByPhoneNumber.linkedId },
              { id: contactByEmail.linkedId },
            ],
          },
          orderBy: { createdAt: "asc" },
        });

        // NOW: just like the other cases, we're merging primaries again.
        await prisma.contact.updateMany({
          where: {
            OR: [
              { id: theirPrimaries[1].id },
              { linkedId: theirPrimaries[1].id },
            ],
          },
          data: {
            linkedId: theirPrimaries[0].id,
            linkPrecedence: "secondary",
          },
        });

        primaryContactId = theirPrimaries[0].id;
      }
    }
  }

  // Whatever the cases, in the absolute end I should return the following:

  // again for type safety
  if (typeof primaryContactId !== "number") {
    return NextResponse.json(
      {
        message: "Error: Somehow the primary contact ID is not a number.",
      },
      { status: 400 }
    );
  }

  const contactEmails = await prisma.contact.findMany({
    select: {
      email: true,
    },
    where: {
      OR: [{ id: primaryContactId }, { linkedId: primaryContactId }],
    },
    // because the primary contact will always be the oldest // FALSE
    // If mcfly is secondary but is attached to a more recent primary,
    // mcfly here shows up first instead of its new primary.
    // I can fix this issue in the orderBy, since
    // "primary" alphabetically comes before "secondary".
    orderBy: [{ linkPrecedence: "asc" }, { createdAt: "asc" }],
  });

  const contactPhoneNumbers = await prisma.contact.findMany({
    select: {
      phoneNumber: true,
    },
    where: {
      OR: [{ id: primaryContactId }, { linkedId: primaryContactId }],
    },
    // because again the primary contact will always be the oldest // FALSE
    // see fix details above
    // If troubles arise again, I'll just go the Array.prototype.concat() way.
    orderBy: [{ linkPrecedence: "asc" }, { createdAt: "asc" }],
  });

  const contactSecondaryIds = await prisma.contact.findMany({
    select: {
      id: true,
    },
    where: {
      linkedId: primaryContactId,
    },
    orderBy: { createdAt: "asc" },
  });

  // It is preferrable to reduce the amount of database calls.
  // Handling what's left with JavaScript should be the faster, safer way.
  emails = [...new Set(contactEmails.map((e) => e.email))];

  phoneNumbers = [...new Set(contactPhoneNumbers.map((e) => e.phoneNumber))];

  secondaryContactIds = contactSecondaryIds.map((e) => e.id);

  // console.log({
  //   contact: {
  //     primaryContactId,
  //     emails,
  //     phoneNumbers,
  //     secondaryContactIds,
  //   },
  // });

  return NextResponse.json(
    {
      contact: {
        primaryContactId,
        emails,
        phoneNumbers,
        secondaryContactIds,
      },
    },
    { status: 200 }
  );
}

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, extractToken } from '@/lib/auth';
import type { Prisma } from '@prisma/client';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = extractToken(request.headers.get('authorization'));
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });

  const { id } = await params;

  try {
    const member = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const circle = await tx.circle.findUnique({
        where: { id },
        include: { members: true },
      });

      if (!circle) {
        throw Object.assign(new Error('Circle not found'), { status: 404 });
      }

      if (circle.status === 'ACTIVE') {
        throw Object.assign(new Error('Circle has already started'), { status: 400 });
      }

      if (circle.status !== 'PENDING') {
        throw Object.assign(new Error('Circle is not accepting new members'), { status: 400 });
      }

      if (circle.members.length >= circle.maxRounds) {
        throw Object.assign(new Error('Circle is full'), { status: 400 });
      }

      const alreadyMember = circle.members.some((m: { userId: string }) => m.userId === payload.userId);
      if (alreadyMember) {
        throw Object.assign(new Error('You are already a member of this circle'), { status: 409 });
      }

      return tx.circleMember.create({
        data: {
          circleId: id,
          userId: payload.userId,
          rotationOrder: circle.members.length + 1,
        },
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
      });
    });

    return NextResponse.json({ success: true, member }, { status: 201 });
  } catch (error: any) {
    if (error.status) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Join circle error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import {
  MoltTank,
  Launch,
  Contribution,
  Claim,
  Refund,
  UserLaunchPosition,
  GlobalStats,
  SplitOption,
} from "generated";

type SplitOption_t = "SPLIT_70_30" | "SPLIT_50_50" | "SPLIT_30_70";

const SPLIT_OPTIONS: SplitOption_t[] = ["SPLIT_70_30", "SPLIT_50_50", "SPLIT_30_70"];

function getSplitOption(value: bigint): SplitOption_t {
  return SPLIT_OPTIONS[Number(value)] ?? "SPLIT_50_50";
}

async function getOrCreateGlobalStats(context: any): Promise<GlobalStats> {
  let stats = await context.GlobalStats.get("global");
  if (!stats) {
    stats = {
      id: "global",
      totalLaunches: 0,
      totalLaunched: 0,
      totalCancelled: 0,
      totalRaised: 0n,
      totalContributions: 0,
    };
  }
  return stats;
}

async function getOrCreatePosition(
  context: any,
  launchId: bigint,
  user: string
): Promise<UserLaunchPosition> {
  const id = `${launchId.toString()}-${user}`;
  let position = await context.UserLaunchPosition.get(id);
  if (!position) {
    position = {
      id,
      launchId,
      user,
      totalContributed: 0n,
      totalClaimed: 0n,
      totalRefunded: 0n,
    };
  }
  return position;
}

// ── TankCreated ──────────────────────────────────────────────────────────────

MoltTank.TankCreated.handler(async ({ event, context }) => {
  const launch: Launch = {
    id: event.params.launchId.toString(),
    launchId: event.params.launchId,
    creator: event.params.creator,
    tankId: event.params.tankId,
    name: event.params.name,
    symbol: event.params.symbol,
    splitOption: getSplitOption(event.params.splitOption),
    tgeUnlockBps: event.params.tgeUnlockBps,
    vestingCliff: event.params.vestingCliff,
    vestingDuration: event.params.vestingDuration,
    status: "ACTIVE",
    totalRaised: 0n,
    contributorCount: 0,
    tokenAddress: undefined,
    tokensAllocated: undefined,
    treasuryAmount: undefined,
    createdAtBlock: event.block.number,
    createdAtTimestamp: event.block.timestamp,
    launchedAtBlock: undefined,
    launchedAtTimestamp: undefined,
    txHash: event.transaction.hash,
  };
  context.Launch.set(launch);

  const stats = await getOrCreateGlobalStats(context);
  context.GlobalStats.set({
    ...stats,
    totalLaunches: stats.totalLaunches + 1,
  });
});

// ── Contributed ──────────────────────────────────────────────────────────────

MoltTank.Contributed.handler(async ({ event, context }) => {
  const contributionId = `${event.params.launchId.toString()}-${event.transaction.hash}`;
  const contribution: Contribution = {
    id: contributionId,
    launchId: event.params.launchId,
    contributor: event.params.contributor,
    amount: event.params.amount,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  };
  context.Contribution.set(contribution);

  // Update launch totals
  const launch = await context.Launch.get(event.params.launchId.toString());
  if (launch) {
    // Check if this is a new contributor
    const positionId = `${event.params.launchId.toString()}-${event.params.contributor}`;
    const existingPosition = await context.UserLaunchPosition.get(positionId);
    const isNewContributor = !existingPosition || existingPosition.totalContributed === 0n;

    context.Launch.set({
      ...launch,
      totalRaised: launch.totalRaised + event.params.amount,
      contributorCount: isNewContributor
        ? launch.contributorCount + 1
        : launch.contributorCount,
    });
  }

  // Update user position
  const position = await getOrCreatePosition(
    context,
    event.params.launchId,
    event.params.contributor
  );
  context.UserLaunchPosition.set({
    ...position,
    totalContributed: position.totalContributed + event.params.amount,
  });

  // Update global stats
  const stats = await getOrCreateGlobalStats(context);
  context.GlobalStats.set({
    ...stats,
    totalRaised: stats.totalRaised + event.params.amount,
    totalContributions: stats.totalContributions + 1,
  });
});

// ── TokenLaunched ────────────────────────────────────────────────────────────

MoltTank.TokenLaunched.handler(async ({ event, context }) => {
  const launch = await context.Launch.get(event.params.launchId.toString());
  if (launch) {
    context.Launch.set({
      ...launch,
      status: "LAUNCHED",
      tokenAddress: event.params.token,
      totalRaised: event.params.totalRaised,
      tokensAllocated: event.params.tokensAllocated,
      treasuryAmount: event.params.treasuryAmount,
      launchedAtBlock: event.block.number,
      launchedAtTimestamp: event.block.timestamp,
    });
  }

  const stats = await getOrCreateGlobalStats(context);
  context.GlobalStats.set({
    ...stats,
    totalLaunched: stats.totalLaunched + 1,
  });
});

// ── TokensClaimed ────────────────────────────────────────────────────────────

MoltTank.TokensClaimed.handler(async ({ event, context }) => {
  const claimId = `${event.params.launchId.toString()}-${event.params.user}-${event.transaction.hash}`;
  const claim: Claim = {
    id: claimId,
    launchId: event.params.launchId,
    user: event.params.user,
    amount: event.params.amount,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  };
  context.Claim.set(claim);

  // Update user position
  const position = await getOrCreatePosition(
    context,
    event.params.launchId,
    event.params.user
  );
  context.UserLaunchPosition.set({
    ...position,
    totalClaimed: position.totalClaimed + event.params.amount,
  });
});

// ── LaunchCancelled ──────────────────────────────────────────────────────────

MoltTank.LaunchCancelled.handler(async ({ event, context }) => {
  const launch = await context.Launch.get(event.params.launchId.toString());
  if (launch) {
    context.Launch.set({
      ...launch,
      status: "CANCELLED",
    });
  }

  const stats = await getOrCreateGlobalStats(context);
  context.GlobalStats.set({
    ...stats,
    totalCancelled: stats.totalCancelled + 1,
  });
});

// ── Refunded ─────────────────────────────────────────────────────────────────

MoltTank.Refunded.handler(async ({ event, context }) => {
  const refundId = `${event.params.launchId.toString()}-${event.params.user}-${event.transaction.hash}`;
  const refund: Refund = {
    id: refundId,
    launchId: event.params.launchId,
    user: event.params.user,
    amount: event.params.amount,
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
  };
  context.Refund.set(refund);

  // Update user position
  const position = await getOrCreatePosition(
    context,
    event.params.launchId,
    event.params.user
  );
  context.UserLaunchPosition.set({
    ...position,
    totalRefunded: position.totalRefunded + event.params.amount,
  });
});

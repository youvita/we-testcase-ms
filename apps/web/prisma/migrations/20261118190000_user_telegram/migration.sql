-- Each person's own Telegram, for private notifications from the bot.
ALTER TABLE "User" ADD COLUMN "telegramChatId" TEXT;
ALTER TABLE "User" ADD COLUMN "telegramUsername" TEXT;
ALTER TABLE "User" ADD COLUMN "telegramName" TEXT;
ALTER TABLE "User" ADD COLUMN "telegramLinkedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "telegramLinkCode" TEXT;
ALTER TABLE "User" ADD COLUMN "telegramLinkExpiry" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_telegramChatId_key" ON "User"("telegramChatId");
CREATE UNIQUE INDEX "User_telegramLinkCode_key" ON "User"("telegramLinkCode");

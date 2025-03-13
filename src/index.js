import {Bot, InlineKeyboard, session, Keyboard} from "grammy";
import {MongoClient} from "mongodb";
import dotenv from "dotenv";

// Ovoz berish narxlari (so'mda)
const VOTE_PRICES = {
  SINGLE: 10000, // 1 ta ovoz uchun
  DOUBLE: 12000, // 2 ta ovoz bo'lganda har biri uchun
  MEDIUM: 14000, // 3-4 ta ovoz uchun
  HIGH: 20000, // 5-10 ta ovoz uchun
  BULK: 25000, // 10 tadan ko'p ovoz uchun
};

dotenv.config();

// MongoDB ulanish
const client = new MongoClient(process.env.MONGODB_URI);
let db;

async function connectToDatabase() {
  try {
    await client.connect();
    db = client.db();
    console.log("MongoDB ga muvaffaqiyatli ulandi");
  } catch (error) {
    console.error("MongoDB ga ulanishda xatolik:", error);
    process.exit(1);
  }
}

// Bot yaratish
const bot = new Bot(process.env.BOT_TOKEN);

// Session middleware
bot.use(
  session({
    initial: () => ({
      step: "idle",
      phoneNumber: null,
      name: null,
    }),
  })
);

// Main menu keyboard
function getMainKeyboard() {
  return new Keyboard()
    .text("🔗 Ovoz berishni boshlash")
    .row()
    .text("✅ Ovoz berishni tasdiqlash")
    .row()
    .text("💰 Balansni ko'rish")
    .row()
    .text("💳 Pulni yechish")
    .resized()
    .persistent();
}

// Start komandasi
bot.command("start", async (ctx) => {
  ctx.session.step = "ask_name";
  await ctx.reply("Assalomu alaykum! Iltimos ismingizni kiriting:");
});

// Balansni ko'rish
bot.hears("💰 Balansni ko'rish", async (ctx) => {
  try {
    const user = await db
      .collection("users")
      .findOne({telegramId: ctx.from.id});
    if (!user) {
      return await ctx.reply(
        "Siz hali ro'yxatdan o'tmagansiz. /start buyrug'ini yuboring."
      );
    }

    // Joriy ovozlar uchun to'langan summani hisoblash
    const votes = user.votes || 0;

    // Keyingi ovoz narxini hisoblash
    let currentVotePrice;
    const nextVoteCount = votes + 1;

    if (nextVoteCount === 1) {
      currentVotePrice = VOTE_PRICES.SINGLE; // 1-ovoz = 10000
    } else if (nextVoteCount === 2) {
      currentVotePrice = VOTE_PRICES.DOUBLE; // 2-ovoz = 12000
    } else if (nextVoteCount <= 4) {
      currentVotePrice = VOTE_PRICES.MEDIUM; // 3-4 ovoz = 14000
    } else if (nextVoteCount <= 10) {
      currentVotePrice = VOTE_PRICES.HIGH; // 5-10 ovoz = 20000
    } else {
      currentVotePrice = VOTE_PRICES.BULK; // 10+ ovoz = 25000
    }

    await ctx.reply(
      `💰 Sizning balansingiz: ${user.balance || 0} so'm\n` +
        `🎯 Jami ovozlar soni: ${votes} ta\n` +
        `💵 Keyingi ovoz narxi: ${currentVotePrice} so'm\n\n` +
        `ℹ️ Eslatma: Qancha ko'p ovoz bersangiz, shuncha ko'p pul ishlaysiz!\n` +
        `1 ta ovoz = ${VOTE_PRICES.SINGLE} so'm\n` +
        `2 ta ovoz = ${VOTE_PRICES.DOUBLE} x 2 = ${
          VOTE_PRICES.DOUBLE * 2
        } so'm\n` +
        `3-4 ovozlar = ${VOTE_PRICES.MEDIUM} so'm har biri\n` +
        `5-10 ovozlar = ${VOTE_PRICES.HIGH} so'm har biri\n` +
        `10+ ovozlar = ${VOTE_PRICES.BULK} so'm har biri`,
      {
        reply_markup: getMainKeyboard(),
      }
    );
  } catch (error) {
    console.error("Xatolik:", error);
    await ctx.reply("Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.");
  }
});

// Ovoz berish boshlash
bot.hears("🔗 Ovoz berishni boshlash", async (ctx) => {
  const keyboard = new InlineKeyboard().url(
    "Loyihaga o'tish",
    process.env.PROJECT_URL
  );

  await ctx.reply(
    "Ovoz berish uchun quyidagi havolaga o'ting va loyihaga ovoz bering. " +
      'Ovoz berib bo\'lgach, "✅ Ovoz berishni tasdiqlash" tugmasini bosing va ' +
      "ovoz berganligingiz haqidagi ma'lumotlarni yuboring.",
    {
      reply_markup: keyboard,
    }
  );
});

// Ovoz berish uchun button
bot.hears("✅ Ovoz berishni tasdiqlash", async (ctx) => {
  ctx.session.step = "waiting_phone";
  await ctx.reply(
    "Iltimos, ovoz bergan telefon raqamingizni kiriting (Masalan: +998901234567):",
    {
      reply_markup: new Keyboard()
        .text("❌ Bekor qilish")
        .resized()
        .persistent(),
    }
  );
});

// Bekor qilish tugmasi
bot.hears("❌ Bekor qilish", async (ctx) => {
  if (
    ctx.session.step === "waiting_phone" ||
    ctx.session.step === "waiting_screenshot" ||
    ctx.session.step === "waiting_card"
  ) {
    ctx.session.step = "idle";
    ctx.session.phoneNumber = null;
    await ctx.reply(
      ctx.session.step === "waiting_card"
        ? "Pul yechish bekor qilindi."
        : "Ovoz berish bekor qilindi.",
      {
        reply_markup: getMainKeyboard(),
      }
    );
  }
});

// Pulni yechish
bot.hears("💳 Pulni yechish", async (ctx) => {
  try {
    const user = await db
      .collection("users")
      .findOne({telegramId: ctx.from.id});
    if (!user) {
      return await ctx.reply(
        "Siz hali ro'yxatdan o'tmagansiz. /start buyrug'ini yuboring."
      );
    }

    if (!user.balance || user.balance <= 0) {
      return await ctx.reply(
        "Kechirasiz, hisobingizda yechish uchun mablag' mavjud emas.",
        {
          reply_markup: getMainKeyboard(),
        }
      );
    }

    // Faol pul yechish so'rovini tekshirish
    const activeWithdrawal = await db.collection("withdrawals").findOne({
      userId: ctx.from.id,
      status: "pending",
    });

    if (activeWithdrawal) {
      return await ctx.reply(
        "Sizda faol pul yechish so'rovi mavjud. Iltimos admin javobini kuting.",
        {
          reply_markup: getMainKeyboard(),
        }
      );
    }

    ctx.session.step = "waiting_card";
    await ctx.reply(
      `Sizning balansingizda ${user.balance} so'm mavjud.\n\n⚠️ Diqqat! Pul yechib olingandan so'ng barcha ovozlaringiz va balans 0 ga tushiriladi.\n\nPulni yechish uchun karta raqamingizni kiriting:`,
      {
        reply_markup: new Keyboard()
          .text("❌ Bekor qilish")
          .resized()
          .persistent(),
      }
    );
  } catch (error) {
    console.error("Xatolik:", error);
    await ctx.reply("Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.", {
      reply_markup: getMainKeyboard(),
    });
  }
});

// Xabarlarni qayta ishlash
bot.on("message", async (ctx) => {
  const step = ctx.session.step;

  if (step === "ask_name") {
    const name = ctx.message.text;
    try {
      // Avval foydalanuvchini tekshiramiz
      const existingUser = await db
        .collection("users")
        .findOne({telegramId: ctx.from.id});

      if (existingUser) {
        // Mavjud foydalanuvchi bo'lsa faqat ismini yangilaymiz
        await db.collection("users").updateOne(
          {telegramId: ctx.from.id},
          {
            $set: {
              name: name,
              username: ctx.from.username, // username ham yangilanishi mumkin
            },
          }
        );
      } else {
        // Yangi foydalanuvchi bo'lsa to'liq ma'lumotlarni kiritamiz
        await db.collection("users").insertOne({
          telegramId: ctx.from.id,
          username: ctx.from.username,
          name: name,
          balance: 0,
          votes: 0,
          phoneNumbers: [], // Ovoz bergan telefon raqamlar massivi
          registeredAt: new Date(),
        });
      }

      const priceInfo = `
🎯 Ovoz berish narxlari:
1️⃣ 1 ta ovoz: ${VOTE_PRICES.SINGLE} so'm
2️⃣ 2 ta ovoz: har biri ${VOTE_PRICES.DOUBLE} so'm (jami ${
        VOTE_PRICES.DOUBLE * 2
      } so'm)
3️⃣ 3-4 ovoz: har biri ${VOTE_PRICES.MEDIUM} so'm
4️⃣ 5-10 ovoz: har biri ${VOTE_PRICES.HIGH} so'm
5️⃣ 10+ ovoz: har biri ${VOTE_PRICES.BULK} so'm

💡 Misol uchun:
1 ta ovoz = ${VOTE_PRICES.SINGLE} so'm
2 ta ovoz = ${VOTE_PRICES.DOUBLE} x 2 = ${VOTE_PRICES.DOUBLE * 2} so'm
3 ta ovoz = ${VOTE_PRICES.MEDIUM} x 3 = ${VOTE_PRICES.MEDIUM * 3} so'm
4 ta ovoz = ${VOTE_PRICES.MEDIUM} x 4 = ${VOTE_PRICES.MEDIUM * 4} so'm
5 ta ovoz = ${VOTE_PRICES.HIGH} x 5 = ${VOTE_PRICES.HIGH * 5} so'm`;

      await ctx.reply(
        `Rahmat, ${name}! ${
          existingUser
            ? "Ismingiz yangilandi"
            : "Siz muvaffaqiyatli ro'yxatdan o'tdingiz"
        }.\n${priceInfo}\n\nQuyidagi menyudan foydalanishingiz mumkin:`,
        {
          reply_markup: getMainKeyboard(),
        }
      );
      ctx.session.step = "idle";
    } catch (error) {
      console.error("Xatolik:", error);
      await ctx.reply("Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.");
    }
  } else if (step === "waiting_card") {
    if (ctx.message.text === "❌ Bekor qilish") {
      ctx.session.step = "idle";
      return await ctx.reply("Pul yechish bekor qilindi.", {
        reply_markup: getMainKeyboard(),
      });
    }

    const cardNumber = ctx.message.text.replace(/\s+/g, "");
    const cardPattern = /^[0-9]{16}$/;

    if (!cardPattern.test(cardNumber)) {
      return await ctx.reply(
        "Noto'g'ri format. Iltimos 16 raqamdan iborat karta raqamini kiriting:",
        {
          reply_markup: new Keyboard()
            .text("❌ Bekor qilish")
            .resized()
            .persistent(),
        }
      );
    }

    try {
      const user = await db
        .collection("users")
        .findOne({telegramId: ctx.from.id});

      // Pul yechish so'rovini saqlash
      await db.collection("withdrawals").insertOne({
        userId: ctx.from.id,
        cardNumber: cardNumber,
        amount: user.balance,
        status: "pending",
        createdAt: new Date(),
      });

      // Admin guruhiga yuborish
      const keyboard = new InlineKeyboard()
        .text("✅ To'landi", `paid_${ctx.from.id}_${cardNumber}`)
        .text("❌ Karta xato", `wrong_card_${ctx.from.id}_${cardNumber}`);

      await bot.api.sendMessage(
        process.env.ADMIN_GROUP_ID,
        `💳 Yangi pul yechish so'rovi!\n\n` +
          `👤 Foydalanuvchi: ${user.name}\n` +
          `💰 So'ralgan summa: ${user.balance} so'm\n` +
          `💳 Karta raqami: ${cardNumber}`,
        {reply_markup: keyboard}
      );

      ctx.session.step = "idle";
      await ctx.reply(
        "So'rovingiz qabul qilindi. Administratorlar tomonidan ko'rib chiqilgach, pul o'tkazib beriladi.",
        {reply_markup: getMainKeyboard()}
      );
    } catch (error) {
      console.error("Xatolik:", error);
      await ctx.reply("Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.", {
        reply_markup: getMainKeyboard(),
      });
    }
  } else if (step === "waiting_phone") {
    if (ctx.message.text === "❌ Bekor qilish") return;

    const phonePattern = /^\+998\d{9}$/;
    if (!phonePattern.test(ctx.message.text)) {
      return await ctx.reply(
        "Noto'g'ri format. Iltimos telefon raqamni +998901234567 formatida kiriting:",
        {
          reply_markup: new Keyboard()
            .text("❌ Bekor qilish")
            .resized()
            .persistent(),
        }
      );
    }

    // Telefon raqamni tekshirish
    const existingVote = await db.collection("users").findOne({
      phoneNumbers: ctx.message.text,
    });

    if (existingVote) {
      return await ctx.reply(
        "Bu telefon raqam orqali allaqachon ovoz berilgan. Iltimos boshqa telefon raqam kiriting:",
        {
          reply_markup: new Keyboard()
            .text("❌ Bekor qilish")
            .resized()
            .persistent(),
        }
      );
    }

    ctx.session.phoneNumber = ctx.message.text;
    ctx.session.step = "waiting_screenshot";
    await ctx.reply(
      "Endi ovoz berganingiz haqida ekran rasmini (screenshot) yuboring:",
      {
        reply_markup: new Keyboard()
          .text("❌ Bekor qilish")
          .resized()
          .persistent(),
      }
    );
  } else if (step === "waiting_screenshot" && ctx.message.photo) {
    const phoneNumber = ctx.session.phoneNumber;
    const lastThreeDigits = phoneNumber.slice(-3);
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const currentTime = new Date().toLocaleString("uz-UZ");

    try {
      // Telefon raqamni foydalanuvchining raqamlar ro'yxatiga qo'shish
      await db
        .collection("users")
        .updateOne(
          {telegramId: ctx.from.id},
          {$push: {phoneNumbers: phoneNumber}}
        );

      // Admin guruhiga yuborish
      const keyboard = new InlineKeyboard()
        .text(
          "✅ Tasdiqlash",
          `approve_${ctx.from.id}_${phoneNumber.replace("+", "")}`
        )
        .text(
          "❌ Bekor qilish",
          `reject_${ctx.from.id}_${phoneNumber.replace("+", "")}`
        );

      await bot.api.sendPhoto(process.env.ADMIN_GROUP_ID, photo.file_id, {
        caption: `Yangi ovoz!\n\nTelefon: ${phoneNumber}\nOxirgi 3 raqam: ${lastThreeDigits}\nVaqt: ${currentTime}`,
        reply_markup: keyboard,
      });

      await db.collection("votes").insertOne({
        userId: ctx.from.id,
        phoneNumber: phoneNumber,
        photoId: photo.file_id,
        timestamp: new Date(),
        status: "pending",
      });

      ctx.session.step = "idle";
      ctx.session.phoneNumber = null;

      await ctx.reply(
        "Rahmat! Sizning ovozingiz admin tomonidan tekshirilmoqda. Tez orada tasdiqlanadi",
        {
          reply_markup: getMainKeyboard(),
        }
      );
    } catch (error) {
      console.error("Xatolik:", error);
      await ctx.reply("Xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring.", {
        reply_markup: getMainKeyboard(),
      });
    }
  }
});

// Admin tomonidan ovozni tasdiqlash yoki bekor qilish
bot.on("callback_query", async (ctx) => {
  try {
    // Admin tekshirish
    const chatMember = await bot.api.getChatMember(
      process.env.ADMIN_GROUP_ID,
      ctx.from.id
    );

    if (!["administrator", "creator"].includes(chatMember.status)) {
      return await ctx.answerCallbackQuery({
        text: "Faqat adminlar ovozlarni tasdiqlashi mumkin!",
        show_alert: true,
      });
    }

    const data = ctx.callbackQuery.data;

    if (data.startsWith("approve_") || data.startsWith("reject_")) {
      const [action, userId, phoneNumber] = data.split("_");
      const isApprove = action === "approve";
      let votePrice = 0;

      // Ovozni tasdiqlash yoki bekor qilish
      await db.collection("votes").updateOne(
        {
          userId: parseInt(userId),
          phoneNumber: "+" + phoneNumber,
          status: "pending",
        },
        {$set: {status: isApprove ? "approved" : "rejected"}}
      );

      if (!isApprove) {
        // Ovoz bekor qilinganda telefon raqamni ro'yxatdan o'chirish
        await db
          .collection("users")
          .updateOne(
            {telegramId: parseInt(userId)},
            {$pull: {phoneNumbers: "+" + phoneNumber}}
          );
      }

      // Admin xabarini yangilash
      try {
        await ctx.editMessageCaption({
          caption:
            ctx.callbackQuery.message.caption +
            `\n\n${isApprove ? "✅ Tasdiqlandi" : "❌ Bekor qilindi"}`,
        });

        // Buttonlarni o'chirish
        await ctx.editMessageReplyMarkup({reply_markup: {inline_keyboard: []}});
      } catch (error) {
        // Xabar allaqachon o'zgartirilgan bo'lsa, xatolikni e'tiborsiz qoldiramiz
        console.log("Xabarni yangilashda xatolik:", error.message);
      }

      if (isApprove) {
        // Foydalanuvchi ma'lumotlarini olish
        const user = await db
          .collection("users")
          .findOne({telegramId: parseInt(userId)});
        const currentVotes = user.votes || 0;
        const nextVoteCount = currentVotes + 1;

        // Ovoz narxini hisoblash
        let totalEarned = 0;

        if (nextVoteCount === 1) {
          totalEarned = nextVoteCount * VOTE_PRICES.SINGLE;
        } else if (nextVoteCount === 2) {
          totalEarned = nextVoteCount * VOTE_PRICES.DOUBLE;
        } else if (nextVoteCount === 3 || nextVoteCount === 4) {
          totalEarned = nextVoteCount * VOTE_PRICES.MEDIUM;
        } else if (nextVoteCount >= 5 && nextVoteCount <= 10) {
          totalEarned = nextVoteCount * VOTE_PRICES.HIGH;
        } else {
          totalEarned = nextVoteCount * VOTE_PRICES.BULK;
        }

        // Foydalanuvchi balansini va ovozlar sonini yangilash
        await db.collection("users").updateOne(
          {telegramId: parseInt(userId)},
          {
            $inc: {
              balance: totalEarned,
            },
            $set: {
              votes: nextVoteCount,
            },
          }
        );

        // Keyingi ovoz narxini hisoblash
        let nextVotePrice;
        const afterNextVoteCount = nextVoteCount + 1;

        if (afterNextVoteCount === 1) {
          nextVotePrice = VOTE_PRICES.SINGLE; // 1-ovoz = 10000
        } else if (afterNextVoteCount === 2) {
          nextVotePrice = VOTE_PRICES.DOUBLE; // 2-ovoz = 12000
        } else if (afterNextVoteCount <= 4) {
          nextVotePrice = VOTE_PRICES.MEDIUM; // 3-4 ovoz = 14000
        } else if (afterNextVoteCount <= 10) {
          nextVotePrice = VOTE_PRICES.HIGH; // 5-10 ovoz = 20000
        } else {
          nextVotePrice = VOTE_PRICES.BULK; // 10+ ovoz = 25000
        }

        // Foydalanuvchiga xabar
        const userMessage = isApprove
          ? `Sizning ovozingiz tasdiqlandi! \n\n` +
            `💡 Eslatma: Keyingi ovozingiz ${nextVotePrice} so'mdan hisoblanadi!\n\n` +
            `Joriy balansingizni ko'rish uchun "💰 Balansni ko'rish" tugmasini bosing.`
          : "Kechirasiz, sizning ovozingiz tasdiqlanmadi. Iltimos, qaytadan urinib ko'ring.";

        await bot.api.sendMessage(userId, userMessage);
      } else {
        // Foydalanuvchiga xabar
        await bot.api.sendMessage(
          userId,
          "Kechirasiz, sizning ovozingiz tasdiqlanmadi. Iltimos, qaytadan urinib ko'ring."
        );
      }
    } else if (data.startsWith("paid_") || data.startsWith("wrong_card_")) {
      const [action, userId, cardNumber] = data.split("_");
      const isPaid = action === "paid";

      // Pul yechish so'rovini topish
      const withdrawal = await db.collection("withdrawals").findOne({
        userId: parseInt(userId),
        cardNumber: cardNumber,
        status: "pending",
      });

      if (!withdrawal) {
        return await ctx.answerCallbackQuery({
          text: "Pul yechish so'rovi topilmadi!",
          show_alert: true,
        });
      }

      if (isPaid) {
        // Foydalanuvchi ma'lumotlarini olish
        const user = await db.collection("users").findOne({
          telegramId: parseInt(userId),
        });

        // Foydalanuvchi balansidan faqat yechilgan summani ayirish
        await db.collection("users").updateOne(
          {telegramId: parseInt(userId)},
          {$set: {votes: 0}, $inc: {balance: -withdrawal.amount}} // balance dan yechilgan summani ayirish va ovozlarni 0 ga tushirish
        );

        // Pul yechish so'rovini yakunlash
        await db
          .collection("withdrawals")
          .updateOne({_id: withdrawal._id}, {$set: {status: "completed"}});

        // Yangilangan balansni olish
        const updatedUser = await db.collection("users").findOne({
          telegramId: parseInt(userId),
        });

        // Foydalanuvchiga xabar
        await bot.api.sendMessage(
          userId,
          `💰 Sizning ${withdrawal.amount} so'm pulingiz ko'rsatilgan karta raqamiga o'tkazib berildi!\n\n` +
            `💡 Eslatma: Hisobingizda ${updatedUser.balance} so'm qoldi.`
        );
      } else {
        // Pul yechish so'rovini bekor qilish
        await db
          .collection("withdrawals")
          .updateOne({_id: withdrawal._id}, {$set: {status: "rejected"}});

        // Foydalanuvchiga xabar
        await bot.api.sendMessage(
          userId,
          '❌ Kechirasiz, siz kiritgan karta raqami xato. Iltimos, "💳 Pulni yechish" tugmasini bosib, qaytadan urinib ko\'ring.'
        );
      }

      // Admin xabarini yangilash
      try {
        const messageText =
          ctx.callbackQuery.message.text || ctx.callbackQuery.message.caption;
        await ctx.editMessageText(
          messageText +
            `\n\n${isPaid ? "✅ To'landi" : "❌ Karta xato"}\n` +
            `💰 To'langan summa: ${withdrawal.amount} so'm`,
          {
            reply_markup: {inline_keyboard: []},
          }
        );
      } catch (error) {
        console.log("Xabarni yangilashda xatolik:", error.message);
        try {
          const originalText =
            ctx.callbackQuery.message.text || ctx.callbackQuery.message.caption;
          await bot.api.sendMessage(
            process.env.ADMIN_GROUP_ID,
            originalText +
              `\n\n${isPaid ? "✅ To'landi" : "❌ Karta xato"}\n` +
              `💰 To'langan summa: ${withdrawal.amount} so'm`
          );
        } catch (err) {
          console.log("Yangi xabar yuborishda xatolik:", err.message);
        }
      }

      // Admin uchun tasdiqlash xabari
      await ctx.answerCallbackQuery({
        text: isPaid ? "To'lov tasdiqlandi!" : "Karta xato deb belgilandi!",
      });
    }
  } catch (error) {
    console.error("Tasdiqlashda xatolik:", error);
    await ctx.answerCallbackQuery({
      text: "Xatolik yuz berdi!",
      show_alert: true,
    });
  }
});

// Xatoliklarni ushlash
bot.catch((err) => {
  console.error("Bot xatosi:", err);
});

// Botni ishga tushirish
async function startBot() {
  await connectToDatabase();
  await bot.start();
  console.log("Bot ishga tushdi!");
}

startBot();

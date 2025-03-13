import {Bot, InlineKeyboard, session, Keyboard} from "grammy";
import {MongoClient} from "mongodb";
import dotenv from "dotenv";

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
    await ctx.reply(`Sizning balansingiz: ${user.balance || 0} so'm`, {
      reply_markup: getMainKeyboard(),
    });
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
      `Sizning balansingizda ${user.balance} so'm mavjud.\n\nPulni yechish uchun karta raqamingizni kiriting:`,
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
          phoneNumbers: [], // Ovoz bergan telefon raqamlar massivi
          registeredAt: new Date(),
        });
      }

      await ctx.reply(
        `Rahmat, ${name}! ${
          existingUser
            ? "Ismingiz yangilandi"
            : "Siz muvaffaqiyatli ro'yxatdan o'tdingiz"
        }.\n\n` +
          `💰 Har bir ovoz uchun ${process.env.VOTE_AMOUNT} so'm beriladi.\n\n` +
          `Quyidagi menyudan foydalanishingiz mumkin:`,
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
      await ctx.reply("Pul yechish bekor qilindi.", {
        reply_markup: getMainKeyboard(),
      });
      return;
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
          `💰 Balans: ${user.balance} so'm\n` +
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
      "✅ Telefon raqam qabul qilindi!\n\nEndi ovoz berganingiz haqida ekran rasmini (screenshot) yuboring:",
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
      // Telefon raqamni tekshirish
      const existingVote = await db.collection("users").findOne({
        phoneNumbers: phoneNumber,
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

      // Ovozni tasdiqlash yoki bekor qilish
      await db.collection("votes").updateOne(
        {
          userId: parseInt(userId),
          phoneNumber: "+" + phoneNumber,
          status: "pending",
        },
        {$set: {status: isApprove ? "approved" : "rejected"}}
      );

      if (isApprove) {
        // Foydalanuvchi balansini yangilash
        await db
          .collection("users")
          .updateOne(
            {telegramId: parseInt(userId)},
            {$inc: {balance: parseInt(process.env.VOTE_AMOUNT)}}
          );
      }

      // Xabarni yangilash
      const keyboard = new InlineKeyboard();
      await ctx.editMessageCaption({
        caption:
          ctx.callbackQuery.message.caption +
          `\n\n${isApprove ? "✅ Tasdiqlandi" : "❌ Bekor qilindi"}`,
      });

      // Admin uchun tasdiqlash xabari
      await ctx.answerCallbackQuery({
        text: isApprove ? "Ovoz tasdiqlandi!" : "Ovoz bekor qilindi!",
      });

      // Foydalanuvchiga xabar
      const userMessage = isApprove
        ? `Sizning ovozingiz tasdiqlandi! Hisobingizga ${process.env.VOTE_AMOUNT} so'm qo'shildi.\n\nJoriy balansingizni ko'rish uchun "💰 Balansni ko'rish" tugmasini bosing.`
        : "Kechirasiz, sizning ovozingiz tasdiqlanmadi. Iltimos, qaytadan urinib ko'ring.";

      await bot.api.sendMessage(userId, userMessage);
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
          {$inc: {balance: -withdrawal.amount}} // balance dan yechilgan summani ayirish
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
        const messageText = ctx.callbackQuery.message.text;
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
          await bot.api.sendMessage(
            process.env.ADMIN_GROUP_ID,
            ctx.callbackQuery.message.text +
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

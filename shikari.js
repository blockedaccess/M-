require('dotenv').config();
const { Client: UserClient } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');

// Channel ID the user wants to read
// const CHANNEL_ID = '1407236448729567343';
const CHANNEL_ID = process.env.SHIKARI_CHANNEL_ID;

// Initialize user client
const userClient = new UserClient({
    checkUpdate: false,
    ws: { properties: { browser: 'Discord iOS' } }
});

userClient.once('ready', async () => {
    console.log(`Logged in as user: ${userClient.user.tag}`);

    try {
        const channel = await userClient.channels.fetch(CHANNEL_ID);
        if (!channel) {
            console.error('Could not find channel:', CHANNEL_ID);
            process.exit(1);
        }

        console.log(`Listening to channel: ${channel.id} (${channel.name || 'DM/Unknown'})`);

    // Helper to print message content, embeds, and attachments
    function printMessage(msg, prefix = '') {
            const time = new Date(msg.createdAt).toLocaleString();
            const header = `${prefix}[${time}] ${msg.author.tag}:`;

            // Print text content if present
            if (msg.content && msg.content.trim()) {
                console.log(`${header} ${msg.content}`);
            } else {
                console.log(header);
            }

            // Print embeds
            if (msg.embeds && msg.embeds.length > 0) {
                msg.embeds.forEach((embed, i) => {
                    // Skip title, author, thumbnail, and order/account fields
                    if (embed.description) {
                        const desc = String(embed.description).split('\n').map(line => `      ${line}`).join('\n');
                        console.log(`    Description:\n${desc}`);
                    }
                    if (embed.fields && embed.fields.length > 0) {
                        embed.fields.forEach(field => {
                            const lowerName = String(field.name || '').toLowerCase();
                            if (lowerName.includes('order id') || lowerName.includes('account')) return;
                            console.log(`    Field: ${field.name} -> ${field.value}`);
                        });
                    }
                    if (embed.image?.url) console.log(`    Image: ${embed.image.url}`);
                });
            }

            // Print attachments
            if (msg.attachments && msg.attachments.size > 0) {
                msg.attachments.forEach(att => {
                    console.log(`  Attachment: ${att.url}`);
                });
            }
        }

        // Helper to check for the target phrases in content or embeds
        function messageMatches(msg) {
            if (!msg) return false;

            const pattern = /Successful Checkout(?: \(Review Hold\))?/i;

            // Check plain content
            if (msg.content && pattern.test(msg.content)) return true;

            // Check embeds: title, description, fields
            if (msg.embeds && msg.embeds.length > 0) {
                for (const embed of msg.embeds) {
                    if (embed.title && pattern.test(embed.title)) return true;
                    if (embed.description && pattern.test(embed.description)) return true;
                    if (embed.fields && embed.fields.length > 0) {
                        for (const field of embed.fields) {
                            if (field.name && pattern.test(field.name)) return true;
                            if (field.value && pattern.test(field.value)) return true;
                        }
                    }
                }
            }

            return false;
        }


        // Fetch all messages from the channel using pagination
        let allMessages = [];
        let lastId = undefined;
        let fetchMore = true;
        while (fetchMore) {
            const options = lastId ? { limit: 100, before: lastId } : { limit: 100 };
            const batch = await channel.messages.fetch(options);
            const batchArr = Array.from(batch.values());
            if (batchArr.length === 0) break;
            allMessages = allMessages.concat(batchArr);
            lastId = batchArr[batchArr.length - 1].id;
            fetchMore = batchArr.length === 100;
        }

        // Get today's date string in local time (YYYY-MM-DD)
const todayStr = new Date().toLocaleDateString('en-CA'); // 'YYYY-MM-DD' format
        // Print all matching messages (oldest to newest), group by profile, and sum quantity per profile
        let profileTotals = {};
        let profileHits = {};
        let profileSite = {};
        let profileDesc = {};
        let profileDate = {};
        allMessages.reverse().forEach(msg => {
            // Only process messages from today
            const msgDateStr = msg.createdAt.toISOString().slice(0, 10);
            if (msgDateStr !== todayStr) return;
                if (messageMatches(msg)) {
                    // Sum quantity per profile+item and count hits
                    if (msg.embeds && msg.embeds.length > 0) {
                        msg.embeds.forEach(embed => {
                            if (embed.fields && embed.fields.length > 0) {
                                let profile = null;
                                let quantity = null;
                                let site = null;
                                let item = '';
                                embed.fields.forEach(field => {
                                    const lowerName = String(field.name || '').toLowerCase();
                                    if (lowerName.includes('profile')) {
                                        profile = String(field.value).trim();
                                    }
                                    if (lowerName === 'quantity') {
                                        const val = String(field.value).replace(/[^\d]/g, '');
                                        const num = parseInt(val, 10);
                                        if (!isNaN(num)) quantity = num;
                                    }
                                    if (lowerName === 'site') {
                                        site = String(field.value).trim();
                                    }
                                });
                                // Extract item from embed.description
                                if (embed.description) {
                                    const match = embed.description.match(/\[\*\*(.*?)\*\*\]/);
                                    if (match) item = match[1].replace(/,/g, '');
                                }
                                if (profile && quantity !== null) {
                                    const key = `${profile}|||${item}`;
                                    if (!profileTotals[key]) profileTotals[key] = 0;
                                    profileTotals[key] += quantity;
                                    if (!profileHits[key]) profileHits[key] = 0;
                                    profileHits[key] += 1;
                                    if (!profileSite[key] && site) profileSite[key] = site;
                                    if (!profileDesc[key] && embed.description) profileDesc[key] = embed.description;
                                    if (!profileDate[key]) profileDate[key] = msg.createdAt;
                                }
                            }
                        });
                    }
            }
        });
        console.log('\nTotal Quantities by Profile:');
        const csvRows = [];
            csvRows.push('Profile,Quantity,Hit,Site,Item,Date,Status,TXN');
            Object.entries(profileTotals).forEach(([key, total]) => {
                if (total > 0) {
                    let [profile, item] = key.split('|||');
                    profile = profile.replace(/^\|\|/, '').replace(/\|\|$/, '').replace(/,/g, '');
                    item = item.replace(/^\|\|/, '').replace(/\|\|$/, '').replace(/,/g, '');
                    const hits = profileHits[key] || 0;
                    const site = (profileSite[key] || '').replace(/,/g, '');
                    const dateStr = profileDate[key] ? profileDate[key].toLocaleString().replace(/,/g, '') : '';
                    // Print to console
                    console.log(` ${profile} |  Quantity : ${total} | Hit : ${hits} | Site : ${site} | Item : ${item} | Date: ${dateStr}`);
                    // Add to CSV with labels, sanitized
                    csvRows.push(`${profile}, ${total}, ${hits},${site},${item},${dateStr}`);
                }
            });
        // Write CSV file
        const csvPath = path.join(__dirname, 'csv', `shikari_summary_${todayStr}.csv`);
        fs.writeFileSync(csvPath, csvRows.join('\n'), 'utf8');
        console.log(`\nCSV written to: ${csvPath}`);

        // Listen for new messages and print only matching ones
        userClient.on('messageCreate', message => {
            if (message.channelId === CHANNEL_ID && messageMatches(message)) {
                printMessage(message, '[NEW] ');
            }
        });

    } catch (error) {
        console.error('Error fetching channel/messages:', error);
        process.exit(1);
    }
});

userClient.on('error', err => console.error('Client error:', err));

// Login with user token from .env (DISCORD_TOKEN)
if (!process.env.DISCORD_TOKEN) {
    console.error('Please set DISCORD_TOKEN in your .env file');
    process.exit(1);
}

userClient.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('Login failed:', err);
    process.exit(1);
});

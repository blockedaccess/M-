require('dotenv').config();
const { Client: UserClient } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');

// Channel IDs to scan
const CHANNEL_ID = process.env.STELLAR_CHANNEL_ID;

// Initialize user client
const userClient = new UserClient({
    checkUpdate: false,
    ws: { properties: { browser: 'Discord iOS' } }
});

userClient.once('ready', async () => {
    console.log(`Logged in as user: ${userClient.user.tag}`);

    try {
        const pattern = /Successful Checkout!/i;
        const channel = await userClient.channels.fetch(CHANNEL_ID);
        if (!channel) {
            console.error('Could not find channel:', CHANNEL_ID);
            process.exit(1);
        }
        console.log(`Listening to channel: ${channel.id} (${channel.name || 'DM/Unknown'})`);

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

        // Prepare for accumulation
        let profileItemTotals = {};
        let profileItemCounts = {};
        let profileItemProxies = {};
        // Also store product1/product2 per key so they can be output separately
        let profileItemProducts = {};
        let csvRows = ['Profile,Quantity,Hit,Product 1,Product 2,Date+Time,Proxy'];
        // Only process messages from today's date in EST
        const now = new Date();
        const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const yyyy = estNow.getFullYear();
        const mm = String(estNow.getMonth() + 1).padStart(2, '0');
        const dd = String(estNow.getDate()).padStart(2, '0');
        const todayEstStr = `${yyyy}-${mm}-${dd}`;
        allMessages.reverse().forEach(msg => {
            const estDateStr = new Date(msg.createdAt.toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString().slice(0, 10);
            // console.log(todayEstStr);
            if (estDateStr !== todayEstStr) return;
            if (msg.embeds && msg.embeds.length > 0) {
                msg.embeds.forEach(embed => {
                    if (embed.title && pattern.test(embed.title)) {
                        // Extract fields
                        let profile = null;
                        let quantity = null;
                        let proxy = null;
                        let product1 = null;
                        let product2 = null;
                        let item = null;
                        embed.fields.forEach(field => {
                            const name = String(field.name).toLowerCase();
                            if (name === 'profile') profile = field.value.replace(/^\|\|/, '').replace(/\|\|$/, '');
                            if (name === 'quantity') quantity = field.value.replace(/^\|\|/, '').replace(/\|\|$/, '');
                            if (name === 'proxy') proxy = field.value.replace(/^\|\|/, '').replace(/\|\|$/, '');
                            if (name === 'product (1)') product1 = field.value;
                            if (name === 'product (2)') product2 = field.value;
                        });
                        // Use product1 if present, else product2
                        item = product1 || product2 || '';
                        if (profile && item && quantity) {
                            const key = `${profile}|||${item}`;
                            const qtyNum = parseInt(quantity, 10);
                            if (!isNaN(qtyNum)) {
                                if (!profileItemTotals[key]) profileItemTotals[key] = 0;
                                profileItemTotals[key] += qtyNum;
                            }
                            if (!profileItemCounts[key]) profileItemCounts[key] = 0;
                            profileItemCounts[key] += 1;
                            if (proxy) profileItemProxies[key] = proxy;
                            // store product1 and product2 for later CSV output
                            profileItemProducts[key] = { product1: product1 || '', product2: product2 || '' };
                        }
                    }
                });
            }
        });
        // Write CSV file
        Object.keys(profileItemTotals).forEach(key => {
            let [profile, item] = key.split('|||');
            const quantity = profileItemTotals[key];
            const hit = profileItemCounts[key];
            const proxy = profileItemProxies[key] || '';
            const products = profileItemProducts[key] || { product1: '', product2: '' };
            const product1Val = products.product1;
            const product2Val = products.product2;
            // Find the first matching message for this profile/item to get date/time
            const msg = allMessages.find(m => {
                let foundProfile = null;
                let foundItem = null;
                if (m.embeds && m.embeds.length > 0) {
                    m.embeds.forEach(embed => {
                        if (embed.title && pattern.test(embed.title)) {
                            embed.fields.forEach(field => {
                                const name = String(field.name).toLowerCase();
                                if (name === 'profile') foundProfile = field.value.replace(/^\|\|/, '').replace(/\|\|$/, '');
                                if (name === 'product (1)') foundItem = field.value;
                            });
                        }
                    });
                }
                return foundProfile === profile && foundItem === item;
            });
            let dateStr = '';
            let timeStr = '';
            if (msg) {
                const estDate = new Date(msg.createdAt.toLocaleString('en-US', { timeZone: 'America/New_York' }));
                dateStr = estDate.toISOString().slice(0, 10);
                // Format time as h:mmAM/PM
                let hours = estDate.getHours();
                let minutes = estDate.getMinutes();
                let ampm = hours >= 12 ? 'PM' : 'AM';
                hours = hours % 12;
                hours = hours ? hours : 12;
                let minStr = minutes < 10 ? '0' + minutes : minutes;
                timeStr = `${hours}:${minStr}${ampm}`;
            }
            const dateTimeStr = (dateStr && timeStr) ? `${dateStr} ${timeStr}` : '';
            // Order: Profile,Quantity,Product 1,Product 2,Hit,Item,Date+Time,Proxy
            csvRows.push(`${profile},${quantity},${hit},${product1Val},${product2Val},${hit},${dateTimeStr},${proxy}`);
        });
        const todayStr = new Date().toLocaleDateString('en-CA');
        const csvPath = path.join(__dirname, 'csv', `stellar_summary_${todayStr}.csv`);
        fs.writeFileSync(csvPath, csvRows.join('\n'), 'utf8');
        console.log(`CSV written to: ${csvPath}`);
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

require('dotenv').config();
const { Client: UserClient } = require('discord.js-selfbot-v13');
const fs = require('fs');
const { DateTime } = require('luxon');
const path = require('path');
const CHANNEL_ID = process.env.STELLAR_CHANNEL_ID;

if (!process.env.DISCORD_TOKEN) {
	console.error('Please set DISCORD_TOKEN in your .env file');
	process.exit(1);
}

const userClient = new UserClient({
	checkUpdate: false,
	ws: { properties: { browser: 'Discord iOS' } }
});

userClient.on('error', err => console.error('Client error:', err));


userClient.once('ready', async () => {
	console.log(`Logged in as user: ${userClient.user.tag}`);

	try {
		const pattern = /(Successful Checkout!|Checked Out!)/i;
		const channel = await userClient.channels.fetch(CHANNEL_ID);
		if (!channel) {
			console.error('Could not find channel:', CHANNEL_ID);
			process.exit(1);
		}
		console.log(`Listening to channel: ${channel.id} (${channel.name || 'DM/Unknown'})`);

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

		let profileItemTotals = {};
		let profileItemCounts = {};
		let profileItemProxies = {};
		let profileItemProducts = {};
		let csvRows = ['Profile,Quantity,Hit,Product 1,Product 2,Date+Time,Proxy'];
		const todayEstStr = process.env.TODAY;
		allMessages.reverse().forEach(msg => {
			const estDateStr = DateTime.fromJSDate(msg.createdAt)
				.setZone('America/New_York')
				.toISODate(); 
			if (estDateStr !== todayEstStr) return;
			if (msg.embeds && msg.embeds.length > 0) {
				msg.embeds.forEach(embed => {
					if (embed.title && pattern.test(embed.title)) {
						let profile = null;
						let quantity = null;
						let proxy = null;
						let product1 = null;
						let product2 = null;
						let item = null;
						embed.fields.forEach(field => {
							const name = String(field.name).toLowerCase();
							if (name === 'site') {
								siteValue = String(field.value).toLowerCase();
							}
						});
						if (siteValue === 'pokemon center us') {
							embed.fields.forEach(field => {
								const name = String(field.name).toLowerCase();
								if (name === 'profile') profile = field.value.replace(/^\|\|/, '').replace(/\|\|$/, '');
								if (name === 'quantity') quantity = field.value.replace(/^\|\|/, '').replace(/\|\|$/, '');
								if (name === 'product (1)') product1 = field.value;
								if (name === 'product (2)') product2 = field.value;
							});
						} else if (siteValue === 'samsclub') {
							embed.fields.forEach(field => {
								const name = String(field.name).toLowerCase();
								if (name === 'profile') profile = field.value.replace(/^\|\|/, '').replace(/\|\|$/, '');
								quantity = 1;
								if (name === 'product') product1 = field.value;
							});

						}
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
							profileItemProducts[key] = { product1: product1 || '', product2: product2 || '' };
						}
						// Check if the profile contains 'knowledge'
						// if (profile.toLowerCase().includes('knowledge')) {
						//     embed.fields.forEach(field => {
						//         const name = String(field.name).toLowerCase();
						//         if (name.includes('order id')) {
						//             console.log(`Order ID: ${field.value}`);
						//         }
						//         if (name.includes('email')) {
						//             console.log(`Email: ${field.value}`);
						//         }
						//     });
						// }
					}
				});
			}
		});
		Object.keys(profileItemTotals).forEach(key => {
			let [profile, item] = key.split('|||');
			const quantity = profileItemTotals[key];
			const hit = profileItemCounts[key];
			const products = profileItemProducts[key] || { product1: '', product2: '' };
			const product1Val = products.product1;
			const product2Val = products.product2;
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
				let hours = estDate.getHours();
				let minutes = estDate.getMinutes();
				let ampm = hours >= 12 ? 'PM' : 'AM';
				hours = hours % 12;
				hours = hours ? hours : 12;
				let minStr = minutes < 10 ? '0' + minutes : minutes;
				timeStr = `${hours}:${minStr}${ampm}`;
			}
			const dateTimeStr = (dateStr && timeStr) ? `${dateStr} ${timeStr}` : '';
			csvRows.push(`${profile},${quantity},${hit},${product1Val},${product2Val},${dateTimeStr}`);
		});
		const todayStr = todayEstStr;
		const csvPath = path.join(__dirname, 'csv', `stellar_summary_${todayStr}.csv`);
		fs.writeFileSync(csvPath, csvRows.join('\n'), 'utf8');
		console.log(`CSV written to: ${csvPath}`);
		process.exit(0);
	} catch (error) {
		console.error('Error fetching channel/messages:', error);
		process.exit(1);
	}
});

userClient.login(process.env.DISCORD_TOKEN).catch(err => {
	console.error('Login failed:', err);
	process.exit(1);
});

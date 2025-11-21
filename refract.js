require('dotenv').config();
const { Client: UserClient } = require('discord.js-selfbot-v13');
const { DateTime } = require('luxon');
const fs = require('fs');
const path = require('path');
const CHANNEL_ID = process.env.REFRACT_CHANNEL_ID;

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
		const channel = await userClient.channels.fetch(CHANNEL_ID);
		if (!channel) {
			console.error('Could not find channel:', CHANNEL_ID);
			process.exit(1);
		}

		console.log(`Listening to channel: ${channel.id} (${channel.name || 'DM/Unknown'})`);

		function messageMatches(msg) {
			if (!msg) return false;
			const pattern = /Successful Checkout \| Walmart/i;
			if (msg.content && pattern.test(msg.content)) return true;
			if (msg.embeds && msg.embeds.length > 0) {
				for (const embed of msg.embeds) {
    			if (embed.author && embed.author.name && pattern.test(embed.author.name)) return true;
					// if (embed.description && pattern.test(embed.description)) return true;
					// if (embed.fields && embed.fields.length > 0) {
					// 	for (const field of embed.fields) {
					// 		if (field.name && pattern.test(field.name)) return true;
					// 		if (field.value && pattern.test(field.value)) return true;
					// 	}
					// }
				}
			}
			return false;
		}

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

		const todayStr = process.env.TODAY;
		let profileTotals = {};
		let profileHits = {};
		let profileSite = {};
		let profileDesc = {};
		let profileDate = {};
		let csvRows = [];
		csvRows.push('Profile,Quantity,Hit,Item,Date+Time,Proxy');
		allMessages.reverse().forEach(msg => {
			const estDateStr = DateTime.fromJSDate(msg.createdAt)
				.setZone('America/New_York')
				.toISODate();

				if (estDateStr !== todayStr) return;
				if (messageMatches(msg)) {
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
									console.log(profile);
								}
								if (lowerName === 'quantity') {
									const val = String(field.value).replace(/[^\d]/g, '');
									const num = parseInt(val, 10);
									if (!isNaN(num)) quantity = num;
								}
								if (lowerName === 'site') {
									site = String(field.value).trim();
								}
								if (lowerName === 'product') {
									const match = field.value.match(/\[(.*?)\]/);
									item = match ? match[1].trim() : null;
									console.log(item);
								}
							});

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
		csvRows = ['Profile,Cumulative Quantity,Hit,Item,Date,Proxy,Status,TXN'];
		Object.entries(profileTotals).forEach(([key, total]) => {
			if (total > 0) {
				let [profile, item] = key.split('|||');
				profile = profile.replace(/^\|\|/, '').replace(/\|\|$/, '').replace(/,/g, '');
				item = item.replace(/^\|\|/, '').replace(/\|\|$/, '').replace(/,/g, '');
				const hits = profileHits[key] || 0;
				const site = (profileSite[key] || '').replace(/,/g, '');
				const dateStr = profileDate[key] ? profileDate[key].toLocaleString().replace(/,/g, '') : '';
				csvRows.push(`${profile}, ${total}, ${hits},${site},${item},${dateStr}`);
			}
		});
		// Object.keys(profileTotals).forEach(key => {
		// 	const [profile, product] = key.split('|||');
		// 	const quantity = profileProductTotals[key];
		// 	const count = profileProductCounts[key];
		// 	const proxy = profileProductProxies[key] || '';
		// 	const msg = allMessages.find(m => {
		// 		let cleanProfile = profile;
		// 		const profileMatch = String(m.embeds[0]?.fields?.find(f => String(f.name).toLowerCase() === 'profile')?.value || '').match(/\|\|\s*(.*?)\s*\|\|/);
		// 		if (profileMatch) cleanProfile = profileMatch[1];
		// 		let productField = m.embeds[0]?.fields?.find(f => String(f.name).toLowerCase() === 'product');
		// 		let prod = productField ? (String(productField.value).match(/\[(.*?)\]/) ? String(productField.value).match(/\[(.*?)\]/)[1] : productField.value) : '';
		// 		return cleanProfile === profile && prod === product;
		// 	});
		// 	let dateStr = '';
		// 	let timeStr = '';
		// 	if (msg) {
		// 		const estDate = new Date(msg.createdAt.toLocaleString('en-US', { timeZone: 'America/New_York' }));
		// 		dateStr = estDate.toISOString().slice(0, 10);
		// 		let hours = estDate.getHours();
		// 		let minutes = estDate.getMinutes();
		// 		let ampm = hours >= 12 ? 'PM' : 'AM';
		// 		hours = hours % 12;
		// 		hours = hours ? hours : 12;
		// 		let minStr = minutes < 10 ? '0' + minutes : minutes;
		// 		timeStr = `${hours}:${minStr}${ampm}`;
		// 	}
		// 	const dateTimeStr = (dateStr && timeStr) ? `${dateStr} ${timeStr}` : '';
		// 	const item = product;
		// 	csvRows.push(`${profile},${quantity},${count},${item},${dateTimeStr},${proxy}`);
		// });
		const csvPath = path.join(__dirname, 'csv', `refract_summary_${todayStr}.csv`);
		fs.writeFileSync(csvPath, csvRows.join('\n'), 'utf8');
		console.log(`\nCSV written to: ${csvPath}`);
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

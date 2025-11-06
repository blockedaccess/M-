require('dotenv').config();
const { Client: UserClient } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');
const CHANNEL_ID = process.env.REFRACT_CHANNEL_ID;

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

		function messageMatches(msg) {
			if (!msg) return false;

			const pattern = /Successful Checkout \| Walmart/i;
			if (msg.content && pattern.test(msg.content)) return true;
			if (msg.embeds && msg.embeds.length > 0) {
				for (const embed of msg.embeds) {
					console.log(embed)
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
		let profileProductTotals = {};
		let profileProductCounts = {};
		let profileProductProxies = {};
		let csvRows = [];
		csvRows.push('Profile,Quantity,Hit,Item,Date+Time,Proxy');
		allMessages.reverse().forEach(msg => {
			const estDateStr = new Date(msg.createdAt.toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString().slice(0, 10);
			const todayEstStr = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString().slice(0, 10);
			if (estDateStr !== todayEstStr) return;

			msg.embeds.forEach(embed => {
				if (embed.fields && embed.fields.length > 0) {
					let quantity = null;
					let profile = null;
					let product = null;
					let proxy = null;
					embed.fields.forEach(field => {
						const name = String(field.name).toLowerCase();
						if (name === 'quantity') quantity = field.value;
						if (name === 'profile') profile = field.value;
						if (name === 'product') {
							const match = String(field.value).match(/\[(.*?)\]/);
							product = match ? match[1] : field.value;
							if (name === 'proxy details') {
								proxy = match ? match[1].trim() : field.value;
							}
						}
					});
					if (quantity && profile && product) {
						let cleanProfile = profile;
						const profileMatch = String(profile).match(/\|\|\s*(.*?)\s*\|\|/);
						if (profileMatch) cleanProfile = profileMatch[1];
						if (cleanProfile.includes('Sweet Wal')) return;
						const key = `${cleanProfile}|||${product}`;
						const qtyNum = parseInt(quantity, 10);
						if (!isNaN(qtyNum)) {
							if (!profileProductTotals[key]) profileProductTotals[key] = 0;
							profileProductTotals[key] += qtyNum;
						}
						if (!profileProductCounts[key]) profileProductCounts[key] = 0;
						profileProductCounts[key] += 1;

						if (proxy) profileProductProxies[key] = proxy;
					}
				}
			});
			const msgDateStr = msg.createdAt.toISOString().slice(0, 10);
			if (msgDateStr !== todayStr) return;
			if (messageMatches(msg)) {
				if (msg.embeds && msg.embeds.length > 0) {
					msg.embeds.forEach(embed => {
						if (embed.fields && embed.fields.length > 0) {
							embed.forEach(field => {
								console.log(field);
								if (String(field.name).toLowerCase() === 'profile') {
									console.log(field.value);
								}
							});
						}
					});
				}
			}
		});
		csvRows = ['Profile,Cumulative Quantity,Hit,Item,Date,Proxy,Status,TXN'];
		Object.keys(profileProductTotals).forEach(key => {
			const [profile, product] = key.split('|||');
			const quantity = profileProductTotals[key];
			const count = profileProductCounts[key];
			const proxy = profileProductProxies[key] || '';
			const msg = allMessages.find(m => {
				let cleanProfile = profile;
				const profileMatch = String(m.embeds[0]?.fields?.find(f => String(f.name).toLowerCase() === 'profile')?.value || '').match(/\|\|\s*(.*?)\s*\|\|/);
				if (profileMatch) cleanProfile = profileMatch[1];
				let productField = m.embeds[0]?.fields?.find(f => String(f.name).toLowerCase() === 'product');
				let prod = productField ? (String(productField.value).match(/\[(.*?)\]/) ? String(productField.value).match(/\[(.*?)\]/)[1] : productField.value) : '';
				return cleanProfile === profile && prod === product;
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
			const item = product;
			csvRows.push(`${profile},${quantity},${count},${item},${dateTimeStr},${proxy}`);
		});
		const csvPath = path.join(__dirname, 'csv', `refract_summary_${todayStr}.csv`);
		fs.writeFileSync(csvPath, csvRows.join('\n'), 'utf8');
		console.log(`\nCSV written to: ${csvPath}`);
		process.exit(0);

	} catch (error) {
		console.error('Error fetching channel/messages:', error);
		process.exit(1);
	}
});

userClient.on('error', err => console.error('Client error:', err));

if (!process.env.DISCORD_TOKEN) {
	console.error('Please set DISCORD_TOKEN in your .env file');
	process.exit(1);
}

userClient.login(process.env.DISCORD_TOKEN).catch(err => {
	console.error('Login failed:', err);
	process.exit(1);
});

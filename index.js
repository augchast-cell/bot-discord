require('dotenv').config();

// GUILD_ID n'est plus nÃ©cessaire : le bot gÃ¨re tous ses serveurs
const requis = ['TOKEN', 'CLIENT_ID'];
const manquants = requis.filter(k => !process.env[k]?.trim());
if (manquants.length) {
  console.error(`âŒ Variables manquantes dans le .env : ${manquants.join(', ')}`);
  process.exit(1);
}

const { client } = require('./src/bot');
const app = require('./src/web');

const PORT = process.env.PORT || 3000;

client.login(process.env.TOKEN)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`âœ… Dashboard : ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
    });
  })
  .catch(err => {
    console.error('âŒ Connexion Discord Ã©chouÃ©e :', err.message);
    console.error('   â†’ VÃ©rifie le TOKEN dans le .env, et les intents sur le portail dev.');
    process.exit(1);
  });

process.on('unhandledRejection', err => console.error('Erreur non gÃ©rÃ©e :', err));

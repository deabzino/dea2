export type CommandCatalogEntry = {
  name: string;
  category: "Among Us & voice" | "Utility" | "Server logging";
  description: string;
  usage: string;
  example: string;
  aliases: string[];
  requiredPermissions?: string[];
  cooldown?: string;
  type: "slash" | "prefix" | "both";
  hiddenFromWebsite: boolean;
};

// The website filters on one flag. Keep hidden entries here so the catalog
// remains a complete mirror of the bot's registered command names.
export const commandCatalog: CommandCatalogEntry[] = [
  { name: "help", category: "Utility", description: "Open the interactive guide to dea's commands and features.", usage: "/help or .help", example: ".help", aliases: [], type: "both", hiddenFromWebsite: false },
  { name: "status", category: "Utility", description: "Show the people and mute states in your current voice channel.", usage: "/status or .status", example: ".status", aliases: [], type: "both", hiddenFromWebsite: false },
  { name: "uptime", category: "Utility", description: "See how long dea has been running, plus its current ping and server count.", usage: "/uptime or .uptime", example: ".uptime", aliases: [], type: "both", hiddenFromWebsite: false },
  { name: "code", category: "Among Us & voice", description: "Save a six-letter lobby code or show the code saved for this server.", usage: "/code [code] or .code [code]", example: ".code ABCDEF", aliases: [], type: "both", hiddenFromWebsite: false },
  { name: "dead", category: "Among Us & voice", description: "Mark a player dead and server-mute them, or mute them when they next join voice.", usage: "/dead user:<player> or .dead @player", example: ".dead @Jess", aliases: [], type: "both", hiddenFromWebsite: false },
  { name: "undead", category: "Among Us & voice", description: "Start a new round by clearing the dead list, or unmark one player.", usage: "/undead [user] or .undead [@player]", example: ".undead", aliases: [], type: "both", hiddenFromWebsite: false },
  { name: "list", category: "Among Us & voice", description: "List players currently marked dead, including their voice mute state.", usage: "/list or .list", example: ".list", aliases: [], type: "both", hiddenFromWebsite: false },
  { name: "join", category: "Among Us & voice", description: "Join the voice channel you are currently in, with deafening enabled.", usage: "/join or .join", example: ".join", aliases: [], type: "both", hiddenFromWebsite: false },
  { name: "leave", category: "Among Us & voice", description: "Disconnect dea from the voice channel it joined in this server.", usage: "/leave or .leave", example: ".leave", aliases: [], type: "both", hiddenFromWebsite: false },
  { name: "mute", category: "Among Us & voice", description: "Server-mute everyone in your current voice channel for a discussion round.", usage: "/mute or .mute", example: ".mute", aliases: [], type: "both", hiddenFromWebsite: false },
  { name: "unmute", category: "Among Us & voice", description: "Remove round mutes in your current voice channel; marked-dead players stay muted.", usage: "/unmute or .unmute", example: ".unmute", aliases: [], type: "both", hiddenFromWebsite: false },
  { name: "logs", category: "Server logging", description: "Choose a logging channel, toggle event categories, view settings, or ignore a channel, role or user.", usage: "/logs setchannel|toggle|status|ignore", example: "/logs toggle category:voice", aliases: [], requiredPermissions: ["Manage Server"], type: "slash", hiddenFromWebsite: false },
  { name: "nwordcount", category: "Utility", description: "Check a user's counter total.", usage: "/nwordcount [user] or .nwordcount [@user]", example: ".ncount", aliases: ["ncount"], type: "both", hiddenFromWebsite: true },
  { name: "nwordleaderboard", category: "Utility", description: "Show the server counter leaderboard.", usage: "/nwordleaderboard or .nwordleaderboard", example: ".nlb", aliases: ["nlb", "nleaderboard"], type: "both", hiddenFromWebsite: true },
  { name: "nwordclear", category: "Utility", description: "Clear a user's counter total. Requires Manage Server.", usage: "/nwordclear user:<user> or .nwordclear @user", example: ".nclear @user", aliases: ["nclear"], requiredPermissions: ["Manage Server"], type: "both", hiddenFromWebsite: true },
  { name: "nwordcounter", category: "Utility", description: "Enable, disable or check the server counter. Requires Manage Server.", usage: "/nwordcounter action:<enable|disable|status> or .nwordcounter [enable|disable]", example: ".ncounter enable", aliases: ["ncounter"], requiredPermissions: ["Manage Server"], type: "both", hiddenFromWebsite: true },
];

export const publicCommands = () => commandCatalog.filter((command) => !command.hiddenFromWebsite);

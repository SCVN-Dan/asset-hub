/**
 * Groups of words that mean "a kind of" something, so searching for a group
 * finds assets named after its members: "fish" → Shark.fbx, Tuna_A.fbx.
 *
 * `aliases` are other ways to say the group (Vietnamese included, written
 * without diacritics is fine — matching ignores them). A member may itself be
 * a group (animal → fish → shark). Add words freely; nothing else changes.
 */
export interface Concept {
  key: string
  aliases: string[]
  members: string[]
}

export const CONCEPTS: Concept[] = [
  {
    key: 'fish',
    aliases: ['cá', 'sea', 'ocean', 'marine', 'biển', 'sinh vật biển'],
    members: ['shark', 'dolphin', 'tuna', 'salmon', 'whale', 'octopus', 'kraken', 'squid', 'crab', 'shrimp', 'lobster', 'jellyfish', 'starfish', 'eel', 'seahorse', 'turtle', 'coral', 'tentacles', 'carp', 'koi', 'piranha', 'orca']
  },
  {
    key: 'animal',
    aliases: ['động vật', 'con vật', 'thú', 'pet', 'creature'],
    members: ['fish', 'bird', 'beaver', 'bear', 'chicken', 'elephant', 'frog', 'spider', 'wolf', 'horse', 'bat', 'mouse', 'rat', 'pig', 'tiger', 'lion', 'crow', 'dog', 'cat', 'squirrel', 'cow', 'sheep', 'goat', 'rabbit', 'deer', 'fox', 'monkey', 'duck', 'snake', 'lizard', 'chameleon', 'bee', 'butterfly', 'insect']
  },
  { key: 'bird', aliases: ['chim'], members: ['crow', 'chicken', 'duck', 'eagle', 'owl', 'parrot', 'penguin', 'pigeon', 'hen', 'chick'] },
  {
    key: 'monster',
    aliases: ['quái', 'quái vật', 'enemy', 'mob', 'boss', 'kẻ thù'],
    members: ['skeleton', 'devil', 'demon', 'dragon', 'naga', 'undead', 'zombie', 'goblin', 'orc', 'slime', 'gargoyle', 'gagoil', 'golem', 'ghost', 'troll', 'hydra', 'lich', 'mimic', 'treant', 'kraken', 'elemental', 'mandragora', 'werewolf', 'vampire', 'skull', 'spider', 'bat']
  },
  {
    key: 'character',
    aliases: ['nhân vật', 'người', 'human', 'hero', 'npc', 'unit'],
    members: ['player', 'soldier', 'knight', 'wizard', 'mage', 'footman', 'elf', 'dwarf', 'dryad', 'farmer', 'witch', 'warrior', 'rogue', 'mercenary', 'man', 'woman', 'girl', 'boy', 'customer', 'cashier', 'guard', 'spearman', 'rider', 'archer', 'king', 'queen', 'princess', 'worker', 'chef', 'oldman', 'whiteman']
  },
  {
    key: 'weapon',
    aliases: ['vũ khí', 'súng', 'gươm'],
    members: ['sword', 'axe', 'bow', 'crossbow', 'arrow', 'spear', 'gun', 'rifle', 'pistol', 'hammer', 'wand', 'staff', 'harpoon', 'ballista', 'cannon', 'turret', 'bomb', 'blade', 'sickle', 'flamethrower', 'shield', 'dagger', 'knife', 'mace', 'katana']
  },
  {
    key: 'plant',
    aliases: ['cây', 'thực vật', 'vegetation', 'nature', 'foliage'],
    members: ['tree', 'pine', 'palm', 'grass', 'flower', 'mushroom', 'cactus', 'leaf', 'vine', 'lotus', 'bush', 'stump', 'root', 'branches', 'acorn', 'log', 'woodlog', 'bamboo', 'rose', 'seaweed']
  },
  { key: 'rock', aliases: ['đá', 'stone', 'boulder'], members: ['rock', 'stone', 'crystal', 'cliff', 'boulder', 'pebble', 'gem', 'ore', 'fondrock'] },
  {
    key: 'building',
    aliases: ['nhà', 'công trình', 'house', 'structure', 'architecture'],
    members: ['building', 'buliding', 'house', 'tower', 'castle', 'wall', 'gate', 'door', 'bridge', 'temple', 'church', 'windmill', 'smithy', 'shop', 'station', 'fence', 'stairs', 'stair', 'pillar', 'obelisk', 'ruin', 'arch', 'portal', 'stonehouse', 'woodhouse', 'keyhouse', 'hut', 'barn', 'tent', 'roof', 'window']
  },
  {
    key: 'food',
    aliases: ['đồ ăn', 'thức ăn', 'món ăn', 'đồ uống', 'drink'],
    members: ['meat', 'pizza', 'tomato', 'sausage', 'egg', 'sauce', 'bread', 'cheese', 'burger', 'fruit', 'apple', 'banana', 'cake', 'cookie', 'steak', 'sushi', 'noodle', 'rice', 'soup', 'cup', 'plate', 'bowls', 'tuna', 'salmon']
  },
  {
    key: 'vehicle',
    aliases: ['xe', 'phương tiện', 'car'],
    members: ['truck', 'carriage', 'plane', 'car', 'boat', 'ship', 'train', 'cart', 'bike', 'bus', 'tank', 'helicopter', 'rocket']
  },
  {
    key: 'treasure',
    aliases: ['tiền', 'vàng', 'kho báu', 'money', 'loot', 'reward'],
    members: ['coin', 'gold', 'gem', 'goldbox', 'chest', 'money', 'ticket', 'diamond', 'crystal', 'jewel', 'treasure']
  },
  {
    key: 'prop',
    aliases: ['đồ vật', 'đồ đạc', 'nội thất', 'furniture', 'object'],
    members: ['table', 'bed', 'chair', 'barrel', 'box', 'crate', 'lamp', 'rack', 'shelf', 'workbench', 'cauldron', 'brazier', 'torch', 'book', 'cage', 'coffin', 'tray', 'sign', 'flag', 'statue', 'pot', 'bucket', 'basket']
  },
  {
    key: 'terrain',
    aliases: ['địa hình', 'nền', 'đất', 'environment', 'map'],
    members: ['ground', 'floor', 'tile', 'road', 'platform', 'rail', 'railway', 'lava', 'water', 'lake', 'waterfall', 'hill', 'mountain', 'snow', 'ice', 'sand', 'dirt', 'cliff', 'cave', 'dungeon']
  },
  {
    key: 'tool',
    aliases: ['dụng cụ', 'công cụ'],
    members: ['shovel', 'hammer', 'axe', 'drill', 'pulley', 'grinder', 'fishing', 'rod', 'net', 'ladle', 'fork', 'cutter', 'saw', 'pickaxe', 'wrench', 'bait']
  },
  { key: 'fire', aliases: ['lửa'], members: ['fire', 'torch', 'campfire', 'bonfire', 'brazier', 'flame', 'lava', 'hellfire'] },
  // Single words people often type in Vietnamese.
  { key: 'shark', aliases: ['cá mập'], members: [] },
  { key: 'dolphin', aliases: ['cá heo'], members: [] },
  { key: 'whale', aliases: ['cá voi'], members: [] },
  { key: 'octopus', aliases: ['bạch tuộc'], members: [] },
  { key: 'dragon', aliases: ['rồng'], members: [] },
  { key: 'dog', aliases: ['chó'], members: [] },
  { key: 'cat', aliases: ['mèo'], members: [] },
  { key: 'bear', aliases: ['gấu'], members: [] },
  { key: 'wolf', aliases: ['sói', 'wlof'], members: [] },
  { key: 'horse', aliases: ['ngựa'], members: [] },
  { key: 'chicken', aliases: ['gà'], members: [] },
  { key: 'pig', aliases: ['heo', 'lợn'], members: [] },
  { key: 'frog', aliases: ['ếch'], members: [] },
  { key: 'spider', aliases: ['nhện'], members: [] },
  { key: 'sword', aliases: ['kiếm'], members: [] },
  { key: 'bow', aliases: ['cung'], members: [] },
  { key: 'tree', aliases: ['cây cối'], members: ['pine', 'palm', 'treant', 'stump'] },
  { key: 'flower', aliases: ['hoa'], members: ['lotus', 'rose'] },
  { key: 'mushroom', aliases: ['nấm'], members: [] },
  { key: 'grass', aliases: ['cỏ'], members: [] },
  { key: 'box', aliases: ['hộp', 'thùng'], members: ['crate', 'chest', 'goldbox'] },
  { key: 'door', aliases: ['cửa'], members: ['gate'] },
  { key: 'bridge', aliases: ['cầu'], members: [] },
  { key: 'tower', aliases: ['tháp'], members: [] },
  { key: 'castle', aliases: ['lâu đài'], members: [] },
  { key: 'fence', aliases: ['hàng rào', 'rào'], members: ['barricade'] },
  { key: 'ice', aliases: ['băng'], members: ['snow', 'snowball'] },
  { key: 'snow', aliases: ['tuyết'], members: [] },
  { key: 'water', aliases: ['nước'], members: ['lake', 'waterfall', 'sea'] },
  { key: 'wood', aliases: ['gỗ'], members: ['log', 'woodlog', 'planks', 'wooden'] },
  { key: 'skeleton', aliases: ['xương', 'bone'], members: ['skull'] }
]

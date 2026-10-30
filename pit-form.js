/* The pit scouting form (the PIT button). One report per team per event, plus up to 3 photos.
 *
 * Change the questions here; nothing else needs to change. Each field:
 *   code   the column name in the Sheet's Pit tab (keep it the same once used, or a new column starts)
 *   label  what the scout sees
 *   type   'select' (with options), 'number' (with min and max), 'text' or 'textarea'
 * At a new game (Kickoff), update the game-specific questions (how it scores, the climb levels).
 */
window.PIT_FORM = {
  game: 'REBUILT 2026',
  maxPhotos: 3,
  fields: [
    { code: 'drivetrain', label: 'Drivetrain', type: 'select', options: ['Swerve', 'Tank', 'Mecanum', 'Other'] },
    { code: 'scoreMethod', label: 'How it scores fuel', type: 'select', options: ['Shoots from far away', 'Shoots up close', 'Dumps into the hub', 'Does not score fuel'] },
    { code: 'fuelCapacity', label: 'Fuel it can hold at once', type: 'number', min: 0, max: 100 },
    { code: 'intake', label: 'Picks up fuel from', type: 'select', options: ['Floor and human player', 'Floor only', 'Human player only', 'Neither'] },
    { code: 'bestClimb', label: 'Best climb', type: 'select', options: ['No climb', 'Level 1', 'Level 2', 'Level 3'] },
    { code: 'autoPlan', label: 'Autos they have', type: 'text', placeholder: 'e.g. 8 fuel from the depot, then climb' },
    { code: 'weightLb', label: 'Weight (lb)', type: 'number', min: 0, max: 200 },
    { code: 'driverExperience', label: 'Driver experience', type: 'select', options: ['First year', 'Second year', 'Three years or more'] },
    { code: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Strengths, worries, what they want from a partner' }
  ]
};

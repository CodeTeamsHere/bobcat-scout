/* The super-scout's quick tags (super.js). A super-scout watches a whole alliance, not one robot, and
 * notes what the numbers don't show: defense, driving, trouble. Change the words here; the Analytics app
 * counts whatever words it finds, so old notes keep their meaning. */
window.SUPER_FORM = {
  ratingLabel: 'Driver skill',
  maxNote: 300,
  groups: [
    { title: 'Defense', tags: ['Played defense', 'Strong defense', 'Got defended', 'Beat the defense'] },
    { title: 'Scoring', tags: ['Fast cycles', 'Accurate', 'Missed a lot', 'Great auto', 'Bad auto'] },
    { title: 'Driving', tags: ['Skilled driver', 'Shaky driver', 'Smart strategy', 'Rams others'] },
    { title: 'Trouble', tags: ['Broke down', 'Tipped or stuck', 'Penalties', 'Lost connection'] },
    { title: 'Climb', tags: ['Fast climb', 'Climb failed'] }
  ]
};

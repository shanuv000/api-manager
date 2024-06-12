function generateEmailTemplate(matches) {
  let emailContent = `
    <div style="font-family: Arial, sans-serif; color: #333;">
      <h1 style="color: #4CAF50; text-align: center;">Live Cricket Scores</h1>
      <ul style="list-style-type: none; padding: 0;">
  `;

  matches.forEach((match) => {
    emailContent += `
      <li style="margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 8px; background-color: #f9f9f9;">
        <h2 style="color: #2196F3;">${match.title}</h2>
        <h3 style="color: #FF5722;">${match.heading}</h3>
        <p><strong>Details:</strong> ${match.matchDetails}</p>
        <p><strong>Location:</strong> ${match.location}</p>
        <p><strong>Teams:</strong> ${match.playingTeamBat} vs ${match.playingTeamBall}</p>
        <p><strong>Live Score:</strong> Batting: ${match.liveScorebat}, Bowling: ${match.liveScoreball}</p>
        <p><strong>Commentary:</strong> ${match.liveCommentary}</p>
        <div style="margin-top: 10px;">
          <a href="${match.links["Live Score"]}" style="text-decoration: none; color: #fff; background-color: #4CAF50; padding: 10px 15px; border-radius: 5px;">Live Score</a>
          <a href="${match.links.Scorecard}" style="text-decoration: none; color: #fff; background-color: #2196F3; padding: 10px 15px; border-radius: 5px;">Scorecard</a>
          <a href="${match.links["Full Commentary"]}" style="text-decoration: none; color: #fff; background-color: #FF5722; padding: 10px 15px; border-radius: 5px;">Full Commentary</a>
          <a href="${match.links.News}" style="text-decoration: none; color: #fff; background-color: #795548; padding: 10px 15px; border-radius: 5px;">News</a>
        </div>
      </li>
    `;
  });

  emailContent += `
      </ul>
    </div>
  `;

  return emailContent;
}

module.exports = generateEmailTemplate;

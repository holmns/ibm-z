# HazeWise

HazeWise is an exposure-aware activity planner. The user describes a plan in plain language (“10 km run at East Coast Park tonight at 8pm at 7 min/km”). The system works out how much polluted air that session will make them breathe in, combines it with forecast PM2.5 and heat, and returns a risk level with reasons and safer alternatives. The same engine gives organisers (like an ageing centre deciding on a 9am Friday exercise session) an earlier go/no-go than the usual last-minute 7am check.
One honesty point before you submit: you mentioned regression from a baseline in a database, and I don’t think you have that data yet. For version 1, estimate breathing volume from published exercise-physiology relationships (pace → energy cost → ventilation, e.g. ACSM running equations; check the exact formulas). Treat heart rate and personal profile as optional personalisation if time permits. That way the abstract doesn’t promise a model you can’t train in 24 hours.
Abstract answers

## Problem statement

Singapore residents who exercise outdoors, and the organisers who plan group sessions, must decide every day whether it is safe to be outside and when, because heat, humidity and sudden thunderstorms change what is safe, and haze makes that decision more important. Existing tools only report or forecast PM2.5, temperature, humidity and rainfall. They don’t account for what the activity does to the body. A person running breathes in several times more air per minute than a person walking, so the same PM2.5 level means a very different exposure. Heat strain and duration also change with intensity. Turning these raw environmental readings into a risk judgement and planning ahead is hard for most people and small organisers. Community ageing centres, for example, must decide early whether a session will go ahead, which leaves little time to adjust. This project uses AI and open environmental data to monitor conditions and support earlier, safer decisions about outdoor activity.

## Proposed solution (under 200 words)

HazeWise uses AI and open environmental data to help people make safer outdoor activity decisions in Singapore, running on IBM LinuxONE. It continuously monitors NEA PM2.5, temperature, humidity, wind and rainfall data, and a forecasting model predicts conditions for a planned time and place with uncertainty. Users describe a plan in plain language, such as “10 km run at East Coast Park tonight at 8pm at 7 min/km”, and a locally hosted open-source language model extracts the location, time, duration and intensity. An exposure model converts pace and duration into estimated breathing volume using published exercise-physiology relationships, then combines it with forecast PM2.5 and heat stress to give a Low, Medium or High risk level. Instead of simply cancelling, the system recommends adjustments (shorter, slower, later or indoors) so people can stay active safely. It also alerts organisers such as ageing centres early enough to change a session. We benchmark against public forecasts on past haze episodes and report results honestly.

## Target audience

Recreational outdoor exercisers (runners, cyclists, footballers): they plan a session and need to know how risky it is, and what to change, given the conditions.
Event organisers and community centres (e.g. ageing centres, schools, running clubs): they decide whether a group session goes ahead and need an earlier, probability-based go/no-go instead of a morning-of check.
Student athletes and CCA coaches: they train on fixed schedules and need to know when to move or shorten sessions.
Vulnerable groups, via their organisers or caregivers (secondary): risk thresholds can be tightened for groups more sensitive to haze, such as the elderly.

## Datasets

NEA real-time APIs (data.gov.sg): PM2.5/PSI, air temperature, humidity, rainfall, wind speed and direction, and heat stress (WBGT) if available.
NEA historical air quality and weather data for training and backtesting on past haze episodes.
Published exercise-physiology references for pace/intensity-to-breathing-rate relationships (e.g. US EPA Exposure Factors Handbook, ACSM metabolic equations).
ActiveSG, NParks and OneMap location data to map venues (e.g. East Coast Park) to NEA regions and find indoor or sheltered alternatives.
Optional: ASMC/NASA FIRMS fire hotspot data as an early-warning feature.
Benchmark: public air quality forecasts (e.g. IQAir) for comparison, if API access allows.
https://open-meteo.com/en/docs
